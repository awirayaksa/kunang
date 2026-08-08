interface KunangAPI {
  onLoad: (callback: (payload: { file: string | null; cwd: string; t0: number }) => void) => void
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
  setDirty: (dirty: boolean, fileName: string) => void
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
import { initEditor, getEditorContent, setEditorContent, onEditorChange, insertAtCursor } from './editor'
import { toRelativePath, basename } from './relpath'
import { updatePreview } from './preview'
import { initSync } from './sync'
import { exportHTML } from './export'
import { initFind, openFind, closeFind, isFindOpen, refreshFind } from './find'

const viewMode = document.getElementById('view-mode')!
const editMode = document.getElementById('edit-mode')!
const viewContent = document.getElementById('view-content')!
const statusText = document.getElementById('status-text')!

let currentFile: string | null = null
let currentContent = ''
let dirty = false
let fileMissing = false
let isEditMode = false
let zoomLevel = 1
let themeMode: 'auto' | 'light' | 'dark' = 'auto'

let statusTimer: ReturnType<typeof setTimeout> | null = null

function clearStatusTimer() {
  if (statusTimer) {
    clearTimeout(statusTimer)
    statusTimer = null
  }
}

// The status bar shows the open file at rest. Transient messages replace it
// briefly and then it settles back, so a stray "Saved" never masks the path.
function updateStatus() {
  clearStatusTimer()
  updateTitle()

  if (!currentFile) {
    statusText.textContent = 'Ready'
    return
  }

  // A deleted file is a persistent condition, not a transient message â€” it
  // has to survive the flash timer settling back.
  const suffix = fileMissing ? ' â€” file no longer exists on disk' : ''
  statusText.textContent = `${dirty ? 'â— ' : ''}${currentFile}${suffix}`
}

function updateTitle() {
  const name = currentFile ? currentFile.split(/[\\/]/).pop() : null
  // The bullet is the conventional unsaved marker and is the only dirty cue
  // visible when the window is not focused.
  document.title = name ? `${dirty ? 'â— ' : ''}${name}` : 'kunang'
}

function setDirty(value: boolean) {
  if (dirty === value) return
  dirty = value
  updateStatus()
  // The main process owns the close prompt, so it needs to know.
  window.kunang.setDirty(dirty, currentFile ? currentFile.split(/[\\/]/).pop() || '' : '')
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
  isEditMode = false
  if (text !== undefined) {
    renderView(text)
  }
}

/** Replace the view's content. Any open find has to re-run afterwards: its
 *  Ranges point at nodes that no longer exist. */
function renderView(html: string) {
  viewContent.innerHTML = html
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
  isEditMode = true

  initEditor()

  if (currentContent) {
    setEditorContent(currentContent)
  }

  onEditorChange(() => {
    setDirty(true)
    updateEditPreview()
  })

  initSync()
  updateEditPreview()
}

function updateEditPreview() {
  const content = getEditorContent()
  updatePreview(content)
}

// Where the view was scrolled to before entering edit mode, so Esc comes back
// to the same place instead of jumping to the top.
let viewScrollTop = 0

function enterEdit() {
  viewScrollTop = viewMode.scrollTop
  // The find bar searches the view pane, which is about to be hidden.
  closeFind()
  showEdit()
  updateConsentBar()
}

function enterView() {
  currentContent = getEditorContent()
  showView(initRenderer(currentContent, currentFile || ''))

  // Replacing innerHTML resets scrollTop, so restore on the next frame once
  // the new content has been laid out. Approximate by nature: the document
  // may have been edited, and the old offset no longer means quite the same
  // place.
  requestAnimationFrame(() => {
    viewMode.scrollTop = viewScrollTop
  })
}

function toggleEditMode() {
  if (isEditMode) {
    enterView()
  } else {
    enterEdit()
  }
}

async function loadFile(filePath: string) {
  try {
    setStatus(`Loading ${filePath}...`)
    const doc = await window.kunang.readFile(filePath)

    // Consent was granted for the previous document, not this one.
    if (filePath !== currentFile && remoteAllowed) {
      remoteAllowed = false
      window.kunang.revokeRemote()
    }

    currentFile = filePath
    currentContent = doc.content
    dirty = false
    fileMissing = false

    const rendered = initRenderer(doc.content, filePath)
    showView(rendered)
    updateStatus()

    window.kunang.paintDone()

    // After paint, so the restore lands on a laid-out document. Awaiting it
    // before paintDone would put an IPC round-trip on the critical path.
    void restoreScroll(filePath)
  } catch (err) {
    setStatus(`Error loading file: ${err}`)
    showView(`<p>Error loading file: ${err}</p>`)
  }
}

/** Returns whether the document is now safely on disk — the close prompt
 *  depends on this to decide whether closing is safe. */
async function save(): Promise<boolean> {
  // An untitled buffer has nowhere to go without asking first.
  if (!currentFile) return saveAs()
  if (!dirty) return true

  const content = isEditMode ? getEditorContent() : currentContent
  try {
    await window.kunang.saveFile(currentFile, content)
    currentContent = content
    fileMissing = false
    setDirty(false)
    flashStatus('Saved')

    if (isEditMode) {
      renderView(initRenderer(content, currentFile))
    }
    return true
  } catch (err) {
    setStatus(`Save failed: ${err}`)
    return false
  }
}

async function saveAs(): Promise<boolean> {
  const content = isEditMode ? getEditorContent() : currentContent
  const path = await window.kunang.saveFileAs(content)

  // Cancelled — nothing was written, and the caller must not treat that as
  // safe to close over.
  if (!path) return false

  currentFile = path
  currentContent = content
  fileMissing = false
  setDirty(false)
  updateStatus()
  flashStatus('Saved')
  return true
}

async function doExport() {
  const content = isEditMode ? getEditorContent() : currentContent
  const title = document.title.replace(/\.(md|markdown|mdown|mkd|mdx)$/i, '')
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
  if (!currentFile || isEditMode) return
  if (scrollSaveTimer) clearTimeout(scrollSaveTimer)
  // Scroll fires per frame; persisting each one would hammer state.json.
  scrollSaveTimer = setTimeout(() => {
    scrollSaveTimer = null
    if (currentFile) window.kunang.setScroll(currentFile, viewMode.scrollTop)
  }, 250)
}

async function restoreScroll(filePath: string) {
  const y = await window.kunang.getScroll(filePath)
  if (!y) return
  // Only restore if this is still the document on screen â€” the user may have
  // opened another file while the IPC call was in flight.
  if (currentFile !== filePath) return

  // Wait for layout: images and highlighted code can still be resizing, and
  // scrollTop is clamped to the height known at the time it is assigned.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (currentFile === filePath) viewMode.scrollTop = y
    })
  })
}

viewMode.addEventListener('scroll', saveScrollSoon)

window.addEventListener('pagehide', () => {
  // Debounced saves would otherwise be lost when the window closes.
  if (currentFile && !isEditMode) {
    window.kunang.setScroll(currentFile, viewMode.scrollTop)
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
  if (!currentFile) return

  // F5 is also the way to pick up an edited custom.css without restarting the
  // resident host.
  void applyCustomCss()

  try {
    // force: the main process caches open documents, and a reload that
    // returned the cache would defeat the entire point of F5.
    const doc = await window.kunang.readFile(currentFile, true)
    currentContent = doc.content
    fileMissing = false
    setDirty(false)

    if (isEditMode) {
      setEditorContent(doc.content)
      updateEditPreview()
    } else {
      renderView(initRenderer(doc.content, currentFile))
    }

    flashStatus('Reloaded from disk')
  } catch (err) {
    flashStatus(`Reload failed: ${err}`)
  }
}

function doPrint() {
  // Print CSS forces view mode visible, so make sure it holds the current
  // buffer before printing out of edit mode.
  if (isEditMode) {
    currentContent = getEditorContent()
    renderView(initRenderer(currentContent, currentFile || ''))
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
}

function cycleTheme() {
  themeMode = themeMode === 'auto' ? 'light' : themeMode === 'light' ? 'dark' : 'auto'
  applyTheme()
  // Persist so the next window's background colour matches and there is no
  // white flash before the renderer paints.
  window.kunang.setTheme(themeMode)
  flashStatus(`Theme: ${themeMode}`)
}

// Keyboard shortcuts
document.addEventListener('keydown', async (e) => {
  if (e.ctrlKey && e.key === 'e') {
    e.preventDefault()
    toggleEditMode()
  }

  // Edit mode is left alone: CodeMirror's own search panel is already bound to
  // Ctrl+F and handles the event before it reaches this listener.
  if (e.ctrlKey && e.key === 'f' && !isEditMode) {
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
    // window itself.
    if (isFindOpen()) {
      closeFind()
    } else if (isEditMode) {
      enterView()
    } else {
      window.close()
    }
  }

  if (e.ctrlKey && e.key === 'w') {
    e.preventDefault()
    window.close()
  }

  if (e.ctrlKey && e.key === 'o') {
    e.preventDefault()
    const path = await window.kunang.openFileDialog()
    if (path) {
      await loadFile(path)
    }
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

// --- Drag and drop -----------------------------------------------------
// Both handlers must preventDefault, or Electron navigates the window to the
// dropped file — and protocol.ts's will-navigate guard would then hand it to
// the system browser.

const MARKDOWN_RE = /\.(md|markdown|mdown|mkd|mdx)$/i
const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif)$/i

document.addEventListener('dragover', (e) => {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
})

// Capture phase: CodeMirror installs its own drop handler on the editor, and
// this needs to win for file drops before it tries to treat them as text.
document.addEventListener(
  'drop',
  (e) => {
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (files.length === 0) return

    e.preventDefault()
    e.stopPropagation()

    const paths = files.map((f) => window.kunang.getPathForFile(f)).filter((p) => p.length > 0)
    if (paths.length === 0) return

    const markdown = paths.find((p) => MARKDOWN_RE.test(p))
    if (markdown) {
      void loadFile(markdown)
      return
    }

    const images = paths.filter((p) => IMAGE_RE.test(p))
    if (images.length === 0) {
      flashStatus('Not a Markdown or image file')
      return
    }

    if (!isEditMode) {
      flashStatus('Drop images in edit mode to insert them')
      return
    }

    // Relative to the document, so the link keeps working if the folder moves.
    // With no open file there is nothing to be relative to, so use the
    // absolute path.
    const docDir = currentFile ? currentFile.replace(/[/\\][^/\\]*$/, '') : ''
    const snippet = images
      .map((p) => `![${basename(p)}](${docDir ? toRelativePath(docDir, p) : p.replace(/\\/g, '/')})`)
      .join('\n')

    insertAtCursor(snippet)
    flashStatus(`Inserted ${images.length} image${images.length === 1 ? '' : 's'}`)
  },
  true,
)

// --- Remote content consent --------------------------------------------
// Remote images are blocked in the main process by default: a markdown file is
// untrusted input, and one <img> pointing at a remote host is enough to report
// that the document was opened, and from which IP address.

const consentBar = document.getElementById('consent-bar')!
const consentText = document.getElementById('consent-text')!

let remoteAllowed = false

function countRemoteImages(): number {
  return viewContent.querySelectorAll('img[src^="http"]').length
}

function updateConsentBar() {
  if (remoteAllowed || isEditMode) {
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
  remoteAllowed = true
  consentBar.hidden = true
  window.kunang.allowRemote()

  // The blocked requests already failed, so re-render to reissue them now
  // that the main process will let them through.
  if (currentFile) {
    renderView(initRenderer(currentContent, currentFile))
  }
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

initFind(viewMode, viewContent)

// Adopt the persisted theme before the first paint of a reused spare window.
window.kunang.getTheme().then((mode) => {
  themeMode = mode
  applyTheme()
})

// IPC listeners
window.kunang.onLoad((payload) => {
  if (payload.file) {
    loadFile(payload.file)
  }
})

window.kunang.onFileChanged(async ({ path: filePath }) => {
  if (filePath !== currentFile) return

  if (dirty) {
    // Never silently discard the user's edits. Tell them and let them choose.
    setStatus('File changed on disk. F5 to reload, or save to overwrite.')
    return
  }

  try {
    // force: the cached copy is exactly the stale content we are reacting to.
    const doc = await window.kunang.readFile(filePath, true)
    currentContent = doc.content
    fileMissing = false

    if (isEditMode) {
      setEditorContent(doc.content)
      updateEditPreview()
    } else {
      renderView(initRenderer(doc.content, filePath))
    }
    updateStatus()
  } catch {
    // Raced with a delete; the unlink event will report it.
  }
})

window.kunang.onFileRemoved(({ path: filePath }) => {
  if (filePath !== currentFile) return
  // Keep the buffer â€” it is now the only copy left, so discarding it would
  // destroy data. Saving recreates the file.
  fileMissing = true
  updateStatus()
})

window.kunang.onFileRenamed(async ({ from, to }) => {
  if (from !== currentFile) return

  currentFile = to
  fileMissing = false
  updateStatus()

  if (!dirty) {
    try {
      const doc = await window.kunang.readFile(to, true)
      currentContent = doc.content
      if (isEditMode) {
        setEditorContent(doc.content)
        updateEditPreview()
      } else {
        renderView(initRenderer(doc.content, to))
      }
    } catch {
      fileMissing = true
    }
  }

  flashStatus(`Renamed to ${to.split(/[\\/]/).pop()}`)
})

// Menu action handler (triggered from native menu bar)
window.kunang.onMenuAction(async (action) => {
  switch (action) {
    case 'open': {
      const path = await window.kunang.openFileDialog()
      if (path) await loadFile(path)
      break
    }
    case 'save':
      await save()
      break
    case 'save-as':
      await saveAs()
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
  window.kunang.saveResult(await save())
})
