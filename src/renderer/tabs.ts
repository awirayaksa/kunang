// The window's tab list and the strip that shows it.
//
// This module owns storage and presentation only. Every user gesture on the
// strip is reported back through the handlers below rather than acted on here:
// activating a tab has to save the outgoing document's scroll position and
// closing one may have to prompt about unsaved changes, and both of those are
// the shell's business, in main.ts.

import { EditorState } from '@codemirror/state'
import {
  TabData,
  createTab,
  findByPath,
  findById,
  closeAt,
  stepIndex,
  moveTab,
  slotToIndex,
} from './tab-model'
import { basename } from './relpath'

let tabs: TabData[] = []
let active = -1
let nextId = 1

// CodeMirror state per tab, held here rather than on TabData so tab-model.ts
// stays pure data and can be tested outside a browser. This is what carries
// each tab's undo history and cursor across a switch.
const editorStates = new Map<number, EditorState>()

interface Handlers {
  onActivate: (id: number) => void
  onCloseRequest: (id: number) => void
  /** Dropped on the strip: `toIndex` is the position the tab should end up at. */
  onReorder: (id: number, toIndex: number) => void
  /** Dropped away from the strip: the tab wants its own window. */
  onDetach: (id: number) => void
}

let handlers: Handlers = {
  onActivate: () => {},
  onCloseRequest: () => {},
  onReorder: () => {},
  onDetach: () => {},
}

let strip: HTMLElement

export function initTabs(h: Handlers) {
  strip = document.getElementById('tab-strip')!
  handlers = h

  // On the strip rather than on each tab: renderStrip rebuilds its children on
  // every change, and these have to outlive that.
  strip.addEventListener('dragover', onStripDragOver)
  strip.addEventListener('drop', onStripDrop)
  strip.addEventListener('dragleave', onStripDragLeave)
}

export function allTabs(): TabData[] {
  return tabs
}

export function tabCount(): number {
  return tabs.length
}

/** The tab on screen, or null when the window holds no document yet. */
export function activeTab(): TabData | null {
  return active >= 0 && active < tabs.length ? tabs[active] : null
}

export function activeTabIndex(): number {
  return active
}

export function tabForPath(path: string): TabData | null {
  const i = findByPath(tabs, path)
  return i >= 0 ? tabs[i] : null
}

export function tabById(id: number): TabData | null {
  const i = findById(tabs, id)
  return i >= 0 ? tabs[i] : null
}

/** Append a tab without activating it. The caller activates, because that has
 *  to be sequenced against saving the outgoing tab's state. */
export function addTab(path: string | null): TabData {
  const tab = createTab(nextId++, path)
  tabs.push(tab)
  return tab
}

export function setActiveTab(id: number) {
  const i = findById(tabs, id)
  if (i >= 0) active = i
}

export function removeTab(id: number): TabData | null {
  const i = findById(tabs, id)
  if (i < 0) return null

  editorStates.delete(id)

  const result = closeAt(tabs, i, active)
  tabs = result.tabs
  active = result.activeIndex

  return activeTab()
}

/** Move a tab to `toIndex`. Returns whether anything actually moved, so the
 *  caller can skip a repaint and a session write for a no-op drop. */
export function moveTabById(id: number, toIndex: number): boolean {
  const from = findById(tabs, id)
  if (from < 0) return false

  const result = moveTab(tabs, from, toIndex, active)
  if (result.tabs === tabs) return false

  tabs = result.tabs
  active = result.activeIndex
  return true
}

/** The tab `delta` positions away, wrapping. Null when there is nothing to
 *  move to. */
export function neighbourTab(delta: number): TabData | null {
  if (tabs.length < 2) return null
  const i = stepIndex(tabs.length, active, delta)
  return i >= 0 ? tabs[i] : null
}

export function getEditorState(id: number): EditorState | undefined {
  return editorStates.get(id)
}

export function setEditorState(id: number, state: EditorState) {
  editorStates.set(id, state)
}

/** Drop a stowed state, so the tab is rebuilt from its content next time it is
 *  shown. Needed when the file changed underneath a background tab: the stowed
 *  state still holds the old text and would otherwise win. */
export function clearEditorState(id: number) {
  editorStates.delete(id)
}

/** Paths of every open tab, in strip order. Untitled tabs are skipped: they
 *  have nothing to persist and nothing to watch. */
export function openPaths(): string[] {
  return tabs.map((t) => t.path).filter((p): p is string => p !== null)
}

export function dirtyTabs(): TabData[] {
  return tabs.filter((t) => t.dirty)
}

function label(tab: TabData): string {
  return tab.path ? basename(tab.path) : 'Untitled'
}

// --- Dragging a tab ------------------------------------------------------
// Two gestures, one drag: released on the strip the tab is reordered, released
// away from it the tab asks for its own window.
//
// The id of the tab in flight is module state rather than something read back
// out of the DataTransfer, because `dragover` is not allowed to read data —
// only `drop` is, and the insertion marker has to be drawn long before then.

/** A private type, and the only one put on the transfer. With `text/plain` on
 *  it as well, a tab dropped into the editor would paste its own file name
 *  into the document. */
const TAB_MIME = 'application/x-kunang-tab'

let dragId: number | null = null

/** The tab being dragged, or null. Read by the document-wide drop handler,
 *  which is what catches a tab released away from the strip. */
export function draggingTabId(): number | null {
  return dragId
}

function tabElements(): HTMLElement[] {
  return Array.from(strip.querySelectorAll<HTMLElement>('.tab'))
}

/** Whether an event landed on the strip. The document-wide drop handler is in
 *  the capture phase and therefore runs *before* the strip's own, so it has to
 *  ask this before treating a drop as a tear-out. */
export function isInStrip(node: Node | null): boolean {
  return node !== null && strip.contains(node)
}

/** Draw the insertion marker in gap `slot`, or clear it with null. */
function showDropSlot(slot: number | null) {
  const els = tabElements()
  for (const el of els) el.classList.remove('drop-before', 'drop-after')

  if (slot === null || els.length === 0) return

  if (slot >= els.length) {
    els[els.length - 1].classList.add('drop-after')
  } else {
    els[slot].classList.add('drop-before')
  }
}

/** Which gap the pointer is in: 0..count, where n means "before tab n". */
function slotAt(clientX: number): number {
  const els = tabElements()
  for (let i = 0; i < els.length; i++) {
    const rect = els[i].getBoundingClientRect()
    if (clientX < rect.left + rect.width / 2) return i
  }
  return els.length
}

/** Clear every trace of the drag. Called from whichever handler resolves it,
 *  so `dragend` finding `dragId` still set means nothing did. */
export function endTabDrag() {
  dragId = null
  showDropSlot(null)
  for (const el of tabElements()) el.classList.remove('drag-source')
}

function onStripDragOver(e: DragEvent) {
  if (dragId === null) return

  // Without both of these the strip is not a drop target and `drop` never
  // fires here.
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'

  showDropSlot(slotAt(e.clientX))
}

function onStripDragLeave(e: DragEvent) {
  if (dragId === null) return

  // dragleave also fires when the pointer crosses between two tabs inside the
  // strip, which must not clear the marker.
  const to = e.relatedTarget as Node | null
  if (to && strip.contains(to)) return

  showDropSlot(null)
}

function onStripDrop(e: DragEvent) {
  if (dragId === null) return

  e.preventDefault()
  e.stopPropagation()

  const id = dragId
  const from = findById(tabs, id)
  const slot = slotAt(e.clientX)
  endTabDrag()

  if (from >= 0) handlers.onReorder(id, slotToIndex(slot, from))
}

/** Whether a `dragend` position is outside the window. Dropping a tab out
 *  there is the other way to ask for a new window. */
function isOutsideViewport(x: number, y: number): boolean {
  // Chromium reports 0,0 for some cancelled drags. Treat that as unknown
  // rather than as the top-left corner, so Esc never detaches a tab.
  if (x === 0 && y === 0) return false
  return x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight
}

function attachDragHandlers(el: HTMLElement, tab: TabData) {
  el.draggable = true

  el.addEventListener('dragstart', (e) => {
    dragId = tab.id
    el.classList.add('drag-source')

    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData(TAB_MIME, String(tab.id))
    }
  })

  el.addEventListener('dragend', (e) => {
    const id = dragId
    endTabDrag()

    // Still set means no drop handler ran: either the drag was cancelled, or
    // it was released outside the window, and only the position tells them
    // apart.
    if (id !== null && isOutsideViewport(e.clientX, e.clientY)) {
      handlers.onDetach(id)
    }
  })
}

/** Repaint the strip. Cheap enough to call on any change — a window holds tens
 *  of tabs at most, and each is three nodes. */
export function renderStrip() {
  // A single document looks exactly like kunang did before tabs existed.
  strip.hidden = tabs.length < 2
  strip.textContent = ''
  if (strip.hidden) return

  for (const tab of tabs) {
    const el = document.createElement('div')
    el.className = 'tab' + (tab.id === activeTab()?.id ? ' active' : '')
    el.title = tab.path || 'Untitled'

    if (tab.dirty) {
      const dot = document.createElement('span')
      dot.className = 'tab-dirty'
      dot.textContent = '●'
      el.appendChild(dot)
    }

    // textContent, not innerHTML: a file name is untrusted input and may
    // contain angle brackets.
    const name = document.createElement('span')
    name.className = 'tab-label'
    name.textContent = label(tab)
    el.appendChild(name)

    const close = document.createElement('button')
    close.className = 'tab-close'
    close.type = 'button'
    close.textContent = '✕'
    close.title = 'Close tab (Ctrl+W)'
    close.addEventListener('click', (e) => {
      // Without this the click also lands on the tab and activates the very
      // document being closed.
      e.stopPropagation()
      handlers.onCloseRequest(tab.id)
    })
    el.appendChild(close)

    attachDragHandlers(el, tab)

    el.addEventListener('click', () => handlers.onActivate(tab.id))
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault()
        handlers.onCloseRequest(tab.id)
      }
    })

    strip.appendChild(el)
  }

  // Keep the active tab reachable once the strip has started scrolling.
  strip.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}
