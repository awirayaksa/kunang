// The window's tab list and the strip that shows it.
//
// This module owns storage and presentation only. Every user gesture on the
// strip is reported back through the handlers below rather than acted on here:
// activating a tab has to save the outgoing document's scroll position and
// closing one may have to prompt about unsaved changes, and both of those are
// the shell's business, in main.ts.

import { EditorState } from '@codemirror/state'
import { TabData, createTab, findByPath, findById, closeAt, stepIndex } from './tab-model'
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
}

let handlers: Handlers = { onActivate: () => {}, onCloseRequest: () => {} }

let strip: HTMLElement

export function initTabs(h: Handlers) {
  strip = document.getElementById('tab-strip')!
  handlers = h
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
