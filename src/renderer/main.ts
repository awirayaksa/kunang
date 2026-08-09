interface KunangAPI {
  onLoad: (callback: (payload: { file: string | null; cwd: string; t0: number }) => void) => void
  onRestoreTabs: (callback: (payload: { paths: string[] }) => void) => void
  onFileChanged: (callback: (payload: { path: string }) => void) => void
  onFileRemoved: (callback: (payload: { path: string }) => void) => void
  onFileRenamed: (callback: (payload: { from: string; to: string }) => void) => void
  onMenuAction: (callback: (action: string) => void) => void
  readFile: (filePath: string, force?: boolean) => Promise<{ content: string; encoding: string; bom: boolean; eol: string }>
  saveFile: (filePath: string, content: string) => Promise<void>
  saveFileAs: (content: string) => Promise<string | null>
  openFileDialog: () => Promise<string | null>
  paintDone: () => void
  getAppPath: () => Promise<string>
  getTheme: () => Promise<'auto' | 'light' | 'dark'>
  setTheme: (mode: 'auto' | 'light' | 'dark') => void
  getScroll: (filePath: string) => Promise<number>
  setScroll: (filePath: string, y: number) => void
  getCustomCss: () => Promise<string | null>
  getPathForFile: (file: File) => string
  setDirty: (count: number, fileName: string) => void
  tabsChanged: (paths: string[]) => void
  confirmCloseTab: (fileName: string) => Promise<number>
  detachTab: (filePath: string) => Promise<boolean>
  onRequestSave: (callback: () => void) => void
  saveResult: (ok: boolean) => void
  allowRemote: () => void
  revokeRemote: () => void
}

declare global {
  interface Window {
    kunang: KunangAPI
  }
}

import { initRenderer, didSkipHighlight } from './render'
import {
  initEditor,
  getEditorContent,
  setEditorContent,
  onEditorChange,
  insertAtCursor,
  setEditorTheme,
  getEditorView,
  getEditorState as getLiveEditorState,
  swapEditorState,
  makeState,
} from './editor'
import { toRelativePath, basename } from './relpath'
import { updatePreview, resetPreview } from './preview'
import { initSync } from './sync'
import { exportHTML } from './export'
import { initFind, openFind, closeFind, isFindOpen, refreshFind } from './find'
import { enhance } from './lazy-render'
import { TabData, stepIndex } from './tab-model'
import {
  initTabs,
  addTab,
  activeTab,
  activeTabIndex,
  allTabs,
  tabCount,
  tabById,
  tabForPath,
  setActiveTab,
  removeTab,
  moveTabById,
  neighbourTab,
  draggingTabId,
  endTabDrag,
  isInStrip,
  getEditorState,
  setEditorState,
  clearEditorState,
  openPaths,
  dirtyTabs,
  renderStrip,
} from './tabs'

const viewMode = document.getElementById('view-mode')!
const editMode = document.getElementById('edit-mode')!
const viewContent = document.getElementById('view-content')!
const statusText = document.getElementById('status-text')!

// Per window, not per document: zoom and theme are properties of the frame the
// documents are being read in.
let zoomLevel = 1
let themeMode: 'auto' | 'light' | 'dark' = 'auto'

let statusTimer: ReturnType<typeof setTimeout> | null = null

function clearStatusTimer() {
  if (statusTimer) {
    clearTimeout(statusTimer)
    statusTimer = null
  }
}

function tabName(tab: TabData): string {
  return tab.path ? basename(tab.path) : 'Untitled'
}

function escapeHtml(text: string): string {
  const el = document.createElement('div')
  el.textContent = text
  return el.innerHTML
}

// The status bar shows the open file at rest. Transient messages replace it
// briefly and then it settles back, so a stray "Saved" never masks the path.
function updateStatus() {
  clearStatusTimer()
  updateTitle()

  const tab = activeTab()
  if (!tab || !tab.path) {
    statusText.textContent = 'Ready'
    return
  }

  // A deleted file is a persistent condition, not a transient message — it
  // has to survive the flash timer settling back.
  const suffix = tab.fileMissing ? ' — file no longer exists on disk' : ''
  statusText.textContent = `${tab.dirty ? '● ' : ''}${tab.path}${suffix}`
}

function updateTitle() {
  const tab = activeTab()
  // The bullet is the conventional unsaved marker and is the only dirty cue
  // visible when the window is not focused.
  document.title = tab ? `${tab.dirty ? '● ' : ''}${tabName(tab)}` : 'kunang'
}

/** Tell the main process how much is unsaved. It owns the close prompt, and
 *  with tabs that prompt has to speak for every document in the window. */
function pushDirtyState() {
  const unsaved = dirtyTabs()
  window.kunang.setDirty(unsaved.length, unsaved.length > 0 ? tabName(unsaved[0]) : '')
}

/** The open paths, so the main process can persist the session and stop
 *  watching files no window has open any more. */
function pushTabs() {
  window.kunang.tabsChanged(openPaths())
}

function markDirty(tab: TabData, value: boolean) {
  if (tab.dirty === value) return
  tab.dirty = value

  renderStrip()
  if (tab === activeTab()) updateStatus()
  pushDirtyState()
}

function setDirty(value: boolean) {
  const tab = activeTab()
  if (tab) markDirty(tab, value)
}

function setStatus(text: string) {
  clearStatusTimer()
  statusText.textContent = text
}

function flashStatus(text: string) {
  setStatus(text)
  statusTimer = setTimeout(updateStatus, 2000)
}

function showView(text?: string) {
  viewMode.classList.add('active')
  editMode.classList.remove('active')

  const tab = activeTab()
  if (tab) tab.isEditMode = false

  if (text !== undefined) {
    renderView(text)
  }
}

function isDarkTheme(): boolean {
  if (themeMode === 'dark') return true
  if (themeMode === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** Replace the view's content. Any open find has to re-run afterwards: its
 *  Ranges point at nodes that no longer exist. */
function renderView(html: string) {
  viewContent.innerHTML = html

  const tab = activeTab()
  if (tab) tab.viewHTML = html

  // Math and diagrams resolve asynchronously, after the pane is already
  // painted — the fast path must not wait on a lazy import.
  void enhance(viewContent, isDarkTheme())

  refreshFind()
  updateConsentBar()

  // Say so rather than leaving the user wondering why a large document came
  // back as plain code blocks.
  if (didSkipHighlight()) {
    flashStatus('Large file — syntax highlighting disabled')
  }
}

function showEdit() {
  viewMode.classList.remove('active')
  editMode.classList.add('active')

  const tab = activeTab()
  if (tab) tab.isEditMode = true

  // One EditorView for the life of the window; each tab supplies its own
  // state. Rebuilding it per tab would throw away undo history and pay
  // CodeMirror's construction cost on every switch.
  if (!getEditorView()) {
    initEditor(isDarkTheme())
    onEditorChange(() => {
      setDirty(true)
      updateEditPreview()
    })
  }

  if (tab) {
    swapEditorState(getEditorState(tab.id) ?? makeState(tab.content, isDarkTheme()))
    // A state stowed before the last theme change still carries the old
    // configuration, and reconfiguring is cheaper than tracking which do.
    setEditorTheme(isDarkTheme())
  }

  initSync()
  updateEditPreview()
}

function updateEditPreview() {
  updatePreview(getEditorContent())
}

function enterEdit() {
  const tab = activeTab()
  if (!tab) return

  // Where the view was scrolled to, so Esc comes back to the same place
  // instead of jumping to the top.
  tab.viewScrollTop = viewMode.scrollTop
  // The find bar searches the view pane, which is about to be hidden.
  closeFind()
  showEdit()
  updateConsentBar()
}

function enterView() {
  const tab = activeTab()
  if (!tab) return

  tab.content = getEditorContent()
  setEditorState(tab.id, getLiveEditorState()!)
  showView(initRenderer(tab.content, tab.path || ''))

  // Replacing innerHTML resets scrollTop, so restore on the next frame once
  // the new content has been laid out. Approximate by nature: the document
  // may have been edited, and the old offset no longer means quite the same
  // place.
  requestAnimationFrame(() => {
    viewMode.scrollTop = tab.viewScrollTop
  })
}

function toggleEditMode() {
  if (activeTab()?.isEditMode) {
    enterView()
  } else {
    enterEdit()
  }
}

// --- Tabs ---------------------------------------------------------------
// Opens are serialised through a queue. Each one is several awaits long, and a
// second file arriving mid-flight — a double-click while the first is still
// loading — would otherwise interleave two activations and leave the pane
// showing one document while the strip claims another.

let queue: Promise<void> = Promise.resolve()

function enqueue(op: () => Promise<void>) {
  queue = queue.then(op).catch((err) => console.error('tab operation failed', err))
}

/** Read a tab's file into it. Touches no DOM, so it is safe to run for a tab
 *  that is not on screen. */
async function loadTabContent(tab: TabData): Promise<void> {
  if (!tab.path) return

  try {
    const doc = await window.kunang.readFile(tab.path)
    tab.content = doc.content
    tab.dirty = false
    tab.fileMissing = false
    tab.loaded = true
    tab.viewHTML = initRenderer(doc.content, tab.path)
  } catch (err) {
    tab.loaded = true
    tab.viewHTML = `<p>Error loading file: ${escapeHtml(String(err))}</p>`
  }
}

/** Stow everything about the tab being left that lives in the DOM. */
function deactivate(tab: TabData) {
  if (tab.isEditMode) {
    const state = getLiveEditorState()
    if (state) setEditorState(tab.id, state)
    tab.content = getEditorContent()
  } else {
    tab.viewScrollTop = viewMode.scrollTop
    if (tab.path) window.kunang.setScroll(tab.path, viewMode.scrollTop)
    // Keep the enhanced DOM — re-inserting this on the way back avoids
    // re-running Mermaid for every diagram in the document.
    tab.viewHTML = viewContent.innerHTML
  }

  closeFind()
}

/** Remote images are permitted per webContents, which every tab in this window
 *  shares, so the grant has to follow whichever document is on screen. */
function syncRemoteConsent(tab: TabData) {
  if (tab.remoteAllowed) {
    window.kunang.allowRemote()
  } else {
    window.kunang.revokeRemote()
  }
}

async function activateTab(id: number): Promise<void> {
  const incoming = tabById(id)
  if (!incoming) return

  const outgoing = activeTab()
  if (outgoing && outgoing.id !== id) deactivate(outgoing)

  // morphdom transforms whatever is already in the preview pane; without this
  // it would diff one document against another.
  resetPreview()

  setActiveTab(id)
  syncRemoteConsent(incoming)

  // Restored tabs carry a path and nothing else until they are first looked at.
  if (!incoming.loaded) {
    setStatus(`Loading ${incoming.path}...`)
    await loadTabContent(incoming)
    if (activeTab()?.id !== id) return
  }

  if (incoming.isEditMode) {
    showEdit()
  } else {
    if (incoming.viewHTML === null) {
      incoming.viewHTML = initRenderer(incoming.content, incoming.path || '')
    }
    showView(incoming.viewHTML)

    const y = incoming.viewScrollTop
    requestAnimationFrame(() => {
      if (activeTab()?.id === id) viewMode.scrollTop = y
    })
  }

  updateStatus()
  renderStrip()
  pushTabs()
}

/**
 * Open a document as a tab, or bring its tab forward if it is already open.
 *
 * Every open path funnels through here: the pipe (a double-click in Explorer),
 * Ctrl+O, a drop, and a link between documents.
 */
async function openInTab(filePath: string): Promise<void> {
  const existing = tabForPath(filePath)
  if (existing) {
    await activateTab(existing.id)
    return
  }

  setStatus(`Loading ${filePath}...`)

  const tab = addTab(filePath)
  await loadTabContent(tab)
  await activateTab(tab.id)

  pushDirtyState()
  window.kunang.paintDone()

  // After paint, so the restore lands on a laid-out document. Awaiting it
  // before paintDone would put an IPC round-trip on the critical path.
  void restoreScroll(tab)
}

async function closeTab(id: number): Promise<void> {
  const tab = tabById(id)
  if (!tab) return

  if (tab.dirty) {
    // Ask about the document the user can see. Prompting about a background
    // tab gives them no way to check what they are about to lose.
    if (tab !== activeTab()) await activateTab(id)

    const choice = await window.kunang.confirmCloseTab(tabName(tab))
    if (choice === 2) return
    if (choice === 0 && !(await saveTab(tab))) return

    // Don't Save: the buffer is being discarded, so stop reporting it as
    // unsaved. Otherwise closing the last tab asks a second time, from the
    // window close guard, about a document the user already gave up on.
    markDirty(tab, false)
  }

  // The last tab going means the window goes. The close guard in the main
  // process still runs, and by now nothing is dirty.
  if (tabCount() === 1) {
    window.close()
    return
  }

  const wasActive = tab === activeTab()
  if (wasActive) deactivate(tab)

  clearEditorState(tab.id)
  const next = removeTab(id)

  renderStrip()
  pushDirtyState()
  pushTabs()

  if (wasActive && next) {
    // removeTab has already picked the successor; render it.
    await activateTab(next.id)
  }
}

/** Put a tab at a new position. Nothing on screen changes — the same document
 *  stays active — so only the strip and the persisted order are touched. */
async function reorderTab(id: number, toIndex: number): Promise<void> {
  if (!moveTabById(id, toIndex)) return

  renderStrip()
  // Strip order is session order: a restored window should come back the way
  // the user arranged it.
  pushTabs()
}

/** The keyboard route to a reorder, on the keys every browser uses for it.
 *  Wraps, like Ctrl+PageDown does. */
function shiftTab(delta: number) {
  enqueue(async () => {
    const tab = activeTab()
    if (!tab || tabCount() < 2) return
    await reorderTab(tab.id, stepIndex(tabCount(), activeTabIndex(), delta))
  })
}

/**
 * Give a tab its own window.
 *
 * The document moves rather than being copied: the new window loads it from
 * disk and this one closes its tab, so there is never a second buffer for the
 * same file. That is also why an unsaved one cannot go — the new window would
 * read the file and silently lose the edits.
 */
async function detachTab(id: number): Promise<void> {
  const tab = tabById(id)
  if (!tab) return

  // Already a window of its own.
  if (tabCount() < 2) return

  if (!tab.path || tab.dirty) {
    flashStatus('Save the document before moving it to its own window')
    return
  }

  if (!(await window.kunang.detachTab(tab.path))) {
    flashStatus('Could not open a new window')
    return
  }

  await closeTab(id)
}

function stepTab(delta: number) {
  // Resolved inside the queue, not at the keypress: holding Ctrl+Tab enqueues
  // faster than activations complete, and computing the neighbour up front
  // would make every one of them step from the same starting tab.
  enqueue(async () => {
    const next = neighbourTab(delta)
    if (next) await activateTab(next.id)
  })
}

// --- Save ---------------------------------------------------------------

/** Returns whether the document is now safely on disk — the close prompts
 *  depend on this to decide whether closing is safe. */
async function saveTab(tab: TabData): Promise<boolean> {
  // An untitled buffer has nowhere to go without asking first, and the dialog
  // is modal to the window, so only the visible document may raise one.
  if (!tab.path) return tab === activeTab() ? saveAs() : false
  if (!tab.dirty) return true

  const live = tab === activeTab() && tab.isEditMode
  const content = live ? getEditorContent() : tab.content

  try {
    await window.kunang.saveFile(tab.path, content)
    tab.content = content
    tab.fileMissing = false
    tab.viewHTML = initRenderer(content, tab.path)
    markDirty(tab, false)

    // Keep the view pane current so Esc out of edit mode shows what was saved.
    if (live) renderView(tab.viewHTML)
    return true
  } catch (err) {
    setStatus(`Save failed: ${err}`)
    return false
  }
}

async function save(): Promise<boolean> {
  const tab = activeTab()
  if (!tab) return true

  const ok = await saveTab(tab)
  if (ok && tab.path) flashStatus('Saved')
  return ok
}

/** Every dirty document in the window, for the close guard. Stops at the first
 *  failure rather than closing over content that never reached disk. */
async function saveAllDirty(): Promise<boolean> {
  for (const tab of dirtyTabs()) {
    if (!(await saveTab(tab))) return false
  }
  return true
}

async function saveAs(): Promise<boolean> {
  const tab = activeTab()
  if (!tab) return false

  const content = tab.isEditMode ? getEditorContent() : tab.content
  const path = await window.kunang.saveFileAs(content)

  // Cancelled — nothing was written, and the caller must not treat that as
  // safe to close over.
  if (!path) return false

  tab.path = path
  tab.content = content
  tab.fileMissing = false
  tab.viewHTML = initRenderer(content, path)
  markDirty(tab, false)

  updateStatus()
  renderStrip()
  pushTabs()
  flashStatus('Saved')
  return true
}

async function doExport() {
  const tab = activeTab()
  if (!tab) return

  const content = tab.isEditMode ? getEditorContent() : tab.content
  const title = tabName(tab).replace(/\.(md|markdown|mdown|mkd|mdx)$/i, '')
  const html = exportHTML(content, title)

  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${title}.html`
  a.click()
  URL.revokeObjectURL(url)
  flashStatus('Exported HTML')
}

function toggleOutline() {
  const sidebar = document.getElementById('outline-sidebar')
  if (!sidebar) {
    const sidebar = document.createElement('div')
    sidebar.id = 'outline-sidebar'
    sidebar.style.cssText = 'width:240px;border-right:1px solid var(--border);overflow-y:auto;padding:1rem;font-size:14px;display:none'
    sidebar.innerHTML = '<strong>Outline</strong>'
    document.getElementById('app')!.prepend(sidebar)

    // Both #view-content and #preview-content carry .markdown-body, so this
    // picks up whichever pane is currently populated.
    const headings = document.querySelectorAll('.markdown-body h1[data-line], .markdown-body h2[data-line], .markdown-body h3[data-line]')
    let html = '<strong style="display:block;margin-bottom:0.5rem">Outline</strong>'
    headings.forEach((h) => {
      const level = parseInt(h.tagName[1], 10)
      const text = h.textContent || ''
      const line = h.getAttribute('data-line')
      html += `<div style="padding-left:${(level - 1) * 12}px;margin:2px 0;cursor:pointer" data-line="${line}">${text}</div>`
    })
    sidebar.innerHTML = html
    sidebar.style.display = 'block'

    sidebar.querySelectorAll('[data-line]').forEach((el) => {
      el.addEventListener('click', () => {
        const line = parseInt(el.getAttribute('data-line') || '0', 10)
        const target = document.querySelector(`[data-line="${line}"]`)
        if (target) target.scrollIntoView({ behavior: 'smooth' })
      })
    })
  } else {
    sidebar.style.display = sidebar.style.display === 'none' ? 'block' : 'none'
  }
}

// --- Scroll position ---------------------------------------------------
// #view-mode is the scrolling element; #view-content is just its inner column.

let scrollSaveTimer: ReturnType<typeof setTimeout> | null = null

function saveScrollSoon() {
  const tab = activeTab()
  if (!tab?.path || tab.isEditMode) return

  if (scrollSaveTimer) clearTimeout(scrollSaveTimer)
  // Scroll fires per frame; persisting each one would hammer state.json.
  scrollSaveTimer = setTimeout(() => {
    scrollSaveTimer = null
    const current = activeTab()
    if (current?.path) {
      current.viewScrollTop = viewMode.scrollTop
      window.kunang.setScroll(current.path, viewMode.scrollTop)
    }
  }, 250)
}

async function restoreScroll(tab: TabData) {
  if (!tab.path) return

  const y = await window.kunang.getScroll(tab.path)
  if (!y) return

  tab.viewScrollTop = y
  // Only restore if this is still the document on screen — the user may have
  // opened another file while the IPC call was in flight.
  if (activeTab()?.id !== tab.id) return

  // Wait for layout: images and highlighted code can still be resizing, and
  // scrollTop is clamped to the height known at the time it is assigned.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const current = activeTab()
      if (current?.id === tab.id && !current.isEditMode) viewMode.scrollTop = y
    })
  })
}

viewMode.addEventListener('scroll', saveScrollSoon)

window.addEventListener('pagehide', () => {
  // Debounced saves would otherwise be lost when the window closes.
  const tab = activeTab()
  if (tab?.path && !tab.isEditMode) {
    window.kunang.setScroll(tab.path, viewMode.scrollTop)
  }
})

function applyZoom() {
  // CSS zoom rather than Electron's webFrame API: the renderer is sandboxed
  // with no node integration, so webFrame is not reachable from here.
  document.documentElement.style.zoom = String(zoomLevel)
  flashStatus(`Zoom ${Math.round(zoomLevel * 100)}%`)
}

function setZoom(level: number) {
  // Round to avoid 0.1 increments drifting into 1.0000000000000002.
  zoomLevel = Math.round(Math.min(2.5, Math.max(0.5, level)) * 100) / 100
  applyZoom()
}

async function reloadFile() {
  const tab = activeTab()
  if (!tab?.path) return

  // F5 is also the way to pick up an edited custom.css without restarting the
  // resident host.
  void applyCustomCss()

  try {
    // force: the main process caches open documents, and a reload that
    // returned the cache would defeat the entire point of F5.
    const doc = await window.kunang.readFile(tab.path, true)
    tab.content = doc.content
    tab.fileMissing = false
    markDirty(tab, false)

    if (tab.isEditMode) {
      setEditorContent(doc.content)
      updateEditPreview()
    } else {
      renderView(initRenderer(doc.content, tab.path))
    }

    flashStatus('Reloaded from disk')
  } catch (err) {
    flashStatus(`Reload failed: ${err}`)
  }
}

function doPrint() {
  // Print CSS forces view mode visible, so make sure it holds the current
  // buffer before printing out of edit mode.
  const tab = activeTab()
  if (tab?.isEditMode) {
    tab.content = getEditorContent()
    renderView(initRenderer(tab.content, tab.path || ''))
  }
  window.print()
}

function applyTheme() {
  const root = document.documentElement
  if (themeMode === 'auto') {
    // No data-theme at all, so the prefers-color-scheme media query wins.
    delete root.dataset.theme
  } else {
    root.dataset.theme = themeMode
  }

  // CSS variables carry the editor's colours, but CodeMirror's dark flag and
  // syntax highlighting are extensions and have to be reconfigured. No-op when
  // no editor exists yet.
  setEditorTheme(isDarkTheme())

  // Mermaid bakes its palette into the SVG at render time, so an already-drawn
  // diagram keeps the old theme until the document is rendered again. The
  // visible one is redrawn now; the rest are marked stale so they are redrawn
  // when they are next looked at.
  const active = activeTab()
  for (const tab of allTabs()) {
    if (tab !== active) tab.viewHTML = null
  }

  if (active && !active.isEditMode && viewContent.querySelector('.mermaid-block')) {
    renderView(initRenderer(active.content, active.path || ''))
  }
}

function cycleTheme() {
  themeMode = themeMode === 'auto' ? 'light' : themeMode === 'light' ? 'dark' : 'auto'
  applyTheme()
  // Persist so the next window's background colour matches and there is no
  // white flash before the renderer paints.
  window.kunang.setTheme(themeMode)
  flashStatus(`Theme: ${themeMode}`)
}

// In auto mode the OS can change the theme under us while a window is open.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (themeMode === 'auto') applyTheme()
})

// Keyboard shortcuts
document.addEventListener('keydown', async (e) => {
  if (e.ctrlKey && e.key === 'e') {
    e.preventDefault()
    toggleEditMode()
  }

  // Edit mode is left alone: CodeMirror's own search panel is already bound to
  // Ctrl+F and handles the event before it reaches this listener.
  if (e.ctrlKey && e.key === 'f' && !activeTab()?.isEditMode) {
    e.preventDefault()
    openFind()
  }

  if (e.ctrlKey && e.shiftKey && e.key === 'S') {
    e.preventDefault()
    await saveAs()
  }

  if (e.ctrlKey && e.key === 's') {
    e.preventDefault()
    await save()
  }

  if (e.key === 'Escape') {
    // Esc backs out one level at a time: find bar, then edit mode, then the
    // tab, then the window itself.
    if (isFindOpen()) {
      closeFind()
    } else if (activeTab()?.isEditMode) {
      enterView()
    } else if (tabCount() > 1) {
      closeActive()
    } else {
      window.close()
    }
  }

  if (e.ctrlKey && e.key === 'w') {
    e.preventDefault()
    closeActive()
  }

  // A second route to the tab accelerators in the menu, for the Page keys
  // Chromium does not reserve.
  if (e.ctrlKey && !e.shiftKey && (e.key === 'PageDown' || e.key === 'PageUp')) {
    e.preventDefault()
    stepTab(e.key === 'PageDown' ? 1 : -1)
  }

  // Adding Shift moves the tab instead of moving to it.
  if (e.ctrlKey && e.shiftKey && (e.key === 'PageDown' || e.key === 'PageUp')) {
    e.preventDefault()
    shiftTab(e.key === 'PageDown' ? 1 : -1)
  }

  if (e.ctrlKey && e.key === 'o') {
    e.preventDefault()
    const path = await window.kunang.openFileDialog()
    if (path) enqueue(() => openInTab(path))
  }

  if (e.ctrlKey && (e.key === '=' || e.key === '+')) {
    e.preventDefault()
    setZoom(zoomLevel + 0.1)
  }

  if (e.ctrlKey && e.key === '-') {
    e.preventDefault()
    setZoom(zoomLevel - 0.1)
  }

  if (e.ctrlKey && e.key === '0') {
    e.preventDefault()
    setZoom(1)
  }

  if (e.key === 'F5') {
    e.preventDefault()
    await reloadFile()
  }

  if (e.ctrlKey && e.key === 'p') {
    e.preventDefault()
    doPrint()
  }

  if (e.ctrlKey && e.shiftKey && e.key === 'E') {
    e.preventDefault()
    await doExport()
  }

  if (e.ctrlKey && e.shiftKey && e.key === 'T') {
    e.preventDefault()
    cycleTheme()
  }

  if (e.ctrlKey && e.key === '\\') {
    e.preventDefault()
    toggleOutline()
  }
})

function closeActive() {
  const tab = activeTab()
  if (tab) enqueue(() => closeTab(tab.id))
}

// --- Drag and drop -----------------------------------------------------
// Both handlers must preventDefault, or Electron navigates the window to the
// dropped file — and protocol.ts's will-navigate guard would then hand it to
// the system browser.

const MARKDOWN_RE = /\.(md|markdown|mdown|mkd|mdx)$/i
const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif)$/i

document.addEventListener('dragover', (e) => {
  e.preventDefault()
  // A tab in flight is being moved, not copied, and the cursor should say so.
  if (e.dataTransfer) e.dataTransfer.dropEffect = draggingTabId() === null ? 'copy' : 'move'
})

// Capture phase: CodeMirror installs its own drop handler on the editor, and
// this needs to win for file drops before it tries to treat them as text.
document.addEventListener(
  'drop',
  (e) => {
    // A tab dragged off the strip and released over the document: it wants its
    // own window. Caught here rather than in tabs.ts because by this point the
    // strip is not in the event path at all.
    const dragged = draggingTabId()
    if (dragged !== null) {
      // Unless it landed back on the strip, where it is an ordinary reorder.
      // This listener is in the capture phase and so runs before the strip's
      // own handler; without this check it would swallow every reorder.
      if (isInStrip(e.target as Node | null)) return

      e.preventDefault()
      e.stopPropagation()
      // Resolve the drag now: dragend fires after this and would otherwise
      // read it as a release that nothing handled.
      endTabDrag()
      enqueue(() => detachTab(dragged))
      return
    }

    const files = Array.from(e.dataTransfer?.files ?? [])
    if (files.length === 0) return

    e.preventDefault()
    e.stopPropagation()

    const paths = files.map((f) => window.kunang.getPathForFile(f)).filter((p) => p.length > 0)
    if (paths.length === 0) return

    // Every dropped document gets a tab; the last one dropped ends up in front.
    const markdown = paths.filter((p) => MARKDOWN_RE.test(p))
    if (markdown.length > 0) {
      for (const path of markdown) enqueue(() => openInTab(path))
      return
    }

    const images = paths.filter((p) => IMAGE_RE.test(p))
    if (images.length === 0) {
      flashStatus('Not a Markdown or image file')
      return
    }

    const tab = activeTab()
    if (!tab?.isEditMode) {
      flashStatus('Drop images in edit mode to insert them')
      return
    }

    // Relative to the document, so the link keeps working if the folder moves.
    // With no open file there is nothing to be relative to, so use the
    // absolute path.
    const docDir = tab.path ? tab.path.replace(/[/\\][^/\\]*$/, '') : ''
    const snippet = images
      .map((p) => `![${basename(p)}](${docDir ? toRelativePath(docDir, p) : p.replace(/\\/g, '/')})`)
      .join('\n')

    insertAtCursor(snippet)
    flashStatus(`Inserted ${images.length} image${images.length === 1 ? '' : 's'}`)
  },
  true,
)

// --- Links between documents -------------------------------------------
// A relative link to another .md resolves to mdfile://, which will-navigate
// lets through — navigating the whole window to raw Markdown served as text.
// Open it as a tab instead, which is what the link plainly means.

function pathFromMdfileUrl(href: string): string | null {
  try {
    const url = new URL(href)
    if (url.protocol !== 'mdfile:') return null
    return decodeURIComponent(url.pathname.replace(/^\//, ''))
  } catch {
    return null
  }
}

viewContent.addEventListener('click', (e) => {
  const anchor = (e.target as Element | null)?.closest('a[href]')
  if (!anchor) return

  const path = pathFromMdfileUrl(anchor.getAttribute('href') || '')
  if (!path || !MARKDOWN_RE.test(path)) return

  e.preventDefault()
  enqueue(() => openInTab(path.replace(/\//g, '\\')))
})

// --- Remote content consent --------------------------------------------
// Remote images are blocked in the main process by default: a markdown file is
// untrusted input, and one <img> pointing at a remote host is enough to report
// that the document was opened, and from which IP address.

const consentBar = document.getElementById('consent-bar')!
const consentText = document.getElementById('consent-text')!

function countRemoteImages(): number {
  return viewContent.querySelectorAll('img[src^="http"]').length
}

function updateConsentBar() {
  const tab = activeTab()
  if (!tab || tab.remoteAllowed || tab.isEditMode) {
    consentBar.hidden = true
    return
  }

  const n = countRemoteImages()
  if (n === 0) {
    consentBar.hidden = true
    return
  }

  consentText.textContent =
    n === 1
      ? 'This document loads 1 image from the internet.'
      : `This document loads ${n} images from the internet.`
  consentBar.hidden = false
}

document.getElementById('consent-allow')!.addEventListener('click', () => {
  const tab = activeTab()
  if (!tab) return

  tab.remoteAllowed = true
  consentBar.hidden = true
  window.kunang.allowRemote()

  // The blocked requests already failed, so re-render to reissue them now
  // that the main process will let them through.
  renderView(initRenderer(tab.content, tab.path || ''))
})

document.getElementById('consent-dismiss')!.addEventListener('click', () => {
  consentBar.hidden = true
})

// --- User stylesheet ---------------------------------------------------

async function applyCustomCss() {
  const css = await window.kunang.getCustomCss()
  const existing = document.getElementById('kunang-custom-css')

  if (!css) {
    existing?.remove()
    return
  }

  const el = (existing as HTMLStyleElement) || document.createElement('style')
  el.id = 'kunang-custom-css'
  el.textContent = css
  // Appended last so it wins over view.css without needing !important.
  if (!existing) document.head.appendChild(el)
}

void applyCustomCss()

initTabs({
  onActivate: (id) => enqueue(() => activateTab(id)),
  onCloseRequest: (id) => enqueue(() => closeTab(id)),
  onReorder: (id, toIndex) => enqueue(() => reorderTab(id, toIndex)),
  onDetach: (id) => enqueue(() => detachTab(id)),
})

initFind(viewMode, viewContent)

// Adopt the persisted theme before the first paint of a reused spare window.
window.kunang.getTheme().then((mode) => {
  themeMode = mode
  applyTheme()
})

// IPC listeners
window.kunang.onLoad((payload) => {
  if (payload.file) {
    enqueue(() => openInTab(payload.file!))
  }
})

// The previous session's documents, sent before the file that caused this
// window to exist. Their tabs are created empty and read on first activation,
// so restoring a large session costs nothing on the open path.
window.kunang.onRestoreTabs(({ paths }) => {
  enqueue(async () => {
    for (const path of paths) {
      if (!tabForPath(path)) addTab(path)
    }
    renderStrip()
  })
})

window.kunang.onFileChanged(async ({ path: filePath }) => {
  const tab = tabForPath(filePath)
  if (!tab) return

  if (tab.dirty) {
    // Never silently discard the user's edits. Tell them and let them choose.
    if (tab === activeTab()) {
      setStatus('File changed on disk. F5 to reload, or save to overwrite.')
    }
    return
  }

  try {
    // force: the cached copy is exactly the stale content we are reacting to.
    const doc = await window.kunang.readFile(filePath, true)
    tab.content = doc.content
    tab.fileMissing = false
    tab.loaded = true
    tab.viewHTML = null
    // A stowed editor state holds the old text, and it takes precedence over
    // tab.content when the tab is next shown.
    if (tab !== activeTab()) clearEditorState(tab.id)

    if (tab === activeTab()) {
      if (tab.isEditMode) {
        setEditorContent(doc.content)
        updateEditPreview()
      } else {
        renderView(initRenderer(doc.content, filePath))
      }
      updateStatus()
    }
  } catch {
    // Raced with a delete; the unlink event will report it.
  }
})

window.kunang.onFileRemoved(({ path: filePath }) => {
  const tab = tabForPath(filePath)
  if (!tab) return

  // Keep the buffer — it is now the only copy left, so discarding it would
  // destroy data. Saving recreates the file.
  tab.fileMissing = true
  if (tab === activeTab()) updateStatus()
})

window.kunang.onFileRenamed(async ({ from, to }) => {
  const tab = tabForPath(from)
  if (!tab) return

  tab.path = to
  tab.fileMissing = false
  renderStrip()
  pushTabs()
  if (tab === activeTab()) updateStatus()

  if (!tab.dirty) {
    try {
      const doc = await window.kunang.readFile(to, true)
      tab.content = doc.content
      tab.loaded = true
      tab.viewHTML = null
      if (tab !== activeTab()) clearEditorState(tab.id)

      if (tab === activeTab()) {
        if (tab.isEditMode) {
          setEditorContent(doc.content)
          updateEditPreview()
        } else {
          renderView(initRenderer(doc.content, to))
        }
      }
    } catch {
      tab.fileMissing = true
    }
  }

  if (tab === activeTab()) flashStatus(`Renamed to ${basename(to)}`)
})

// Menu action handler (triggered from native menu bar)
window.kunang.onMenuAction(async (action) => {
  switch (action) {
    case 'open': {
      const path = await window.kunang.openFileDialog()
      if (path) enqueue(() => openInTab(path))
      break
    }
    case 'save':
      await save()
      break
    case 'save-as':
      await saveAs()
      break
    case 'close-tab':
      closeActive()
      break
    case 'next-tab':
      stepTab(1)
      break
    case 'prev-tab':
      stepTab(-1)
      break
    case 'print':
      doPrint()
      break
    case 'toggle-edit':
      toggleEditMode()
      break
    case 'toggle-outline':
      toggleOutline()
      break
    case 'zoom-in':
      setZoom(zoomLevel + 0.1)
      break
    case 'zoom-out':
      setZoom(zoomLevel - 0.1)
      break
    case 'zoom-reset':
      setZoom(1)
      break
    case 'reload':
      await reloadFile()
      break
    case 'cycle-theme':
      cycleTheme()
      break
    case 'export':
      await doExport()
      break
  }
})

// The main process intercepts close and asks; a renderer cannot both ask a
// question and act on the answer from beforeunload.
window.kunang.onRequestSave(async () => {
  window.kunang.saveResult(await saveAllDirty())
})
