interface KunangAPI {
  onLoad: (callback: (payload: { file: string | null; cwd: string; t0: number }) => void) => void
  onFileChanged: (callback: (payload: { path: string }) => void) => void
  onMenuAction: (callback: (action: string) => void) => void
  readFile: (filePath: string) => Promise<{ content: string; encoding: string; bom: boolean; eol: string }>
  saveFile: (filePath: string, content: string) => Promise<void>
  saveFileAs: (content: string) => Promise<string | null>
  openFileDialog: () => Promise<string | null>
  paintDone: () => void
  getAppPath: () => Promise<string>
}

declare global {
  interface Window {
    kunang: KunangAPI
  }
}

import { initRenderer } from './render'
import { initEditor, getEditorContent, setEditorContent, onEditorChange } from './editor'
import { updatePreview } from './preview'
import { initSync } from './sync'
import { exportHTML } from './export'

const viewMode = document.getElementById('view-mode')!
const editMode = document.getElementById('edit-mode')!
const viewContent = document.getElementById('view-content')!
const statusText = document.getElementById('status-text')!

let currentFile: string | null = null
let currentContent = ''
let dirty = false
let isEditMode = false
let zoomLevel = 1
let themeMode: 'auto' | 'light' | 'dark' = 'auto'

function setStatus(text: string) {
  statusText!.textContent = text
}

function showView(text?: string) {
  viewMode.classList.add('active')
  editMode.classList.remove('active')
  isEditMode = false
  if (text !== undefined) {
    viewContent.innerHTML = text
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
    dirty = true
    updateEditPreview()
  })

  initSync()
  updateEditPreview()
}

function updateEditPreview() {
  const content = getEditorContent()
  updatePreview(content)
}

async function loadFile(filePath: string) {
  try {
    setStatus(`Loading ${filePath}...`)
    const doc = await window.kunang.readFile(filePath)
    currentFile = filePath
    currentContent = doc.content
    dirty = false

    const rendered = initRenderer(doc.content, filePath)
    showView(rendered)

    document.title = filePath.split(/[\\/]/).pop() || 'kunang'
    setStatus(filePath)

    window.kunang.paintDone()
  } catch (err) {
    setStatus(`Error loading file: ${err}`)
    showView(`<p>Error loading file: ${err}</p>`)
  }
}

async function save() {
  if (!currentFile || !dirty) return

  const content = isEditMode ? getEditorContent() : currentContent
  try {
    await window.kunang.saveFile(currentFile, content)
    currentContent = content
    dirty = false
    setStatus(`Saved ${currentFile}`)

    if (isEditMode) {
      const rendered = initRenderer(content, currentFile)
      viewContent.innerHTML = rendered
    }
  } catch (err) {
    setStatus(`Save failed: ${err}`)
  }
}

async function saveAs() {
  const content = isEditMode ? getEditorContent() : currentContent
  const path = await window.kunang.saveFileAs(content)
  if (path) {
    currentFile = path
    currentContent = content
    dirty = false
    setStatus(`Saved ${path}`)
    document.title = path.split(/[\\/]/).pop() || 'kunang'
  }
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
  setStatus('Exported HTML')
}

function toggleOutline() {
  const sidebar = document.getElementById('outline-sidebar')
  if (!sidebar) {
    const sidebar = document.createElement('div')
    sidebar.id = 'outline-sidebar'
    sidebar.style.cssText = 'width:240px;border-right:1px solid var(--border);overflow-y:auto;padding:1rem;font-size:14px;display:none'
    sidebar.innerHTML = '<strong>Outline</strong>'
    document.getElementById('app')!.prepend(sidebar)

    const content = isEditMode ? initRenderer(getEditorContent(), '') : viewContent.innerHTML
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

// Keyboard shortcuts
document.addEventListener('keydown', async (e) => {
  if (e.ctrlKey && e.key === 'e') {
    e.preventDefault()
    if (isEditMode) {
      currentContent = getEditorContent()
      const rendered = initRenderer(currentContent, currentFile || '')
      showView(rendered)
    } else {
      showEdit()
    }
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
    if (isEditMode) {
      currentContent = getEditorContent()
      const rendered = initRenderer(currentContent, currentFile || '')
      showView(rendered)
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
    zoomLevel = Math.min(2.5, zoomLevel + 0.1)
    applyZoom()
  }

  if (e.ctrlKey && e.key === '-') {
    e.preventDefault()
    zoomLevel = Math.max(0.5, zoomLevel - 0.1)
    applyZoom()
  }

  if (e.ctrlKey && e.key === '0') {
    e.preventDefault()
    zoomLevel = 1
    applyZoom()
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

// IPC listeners
window.kunang.onLoad((payload) => {
  if (payload.file) {
    loadFile(payload.file)
  }
})

window.kunang.onFileChanged(async ({ path: filePath }) => {
  if (filePath === currentFile && !dirty) {
    try {
      const doc = await window.kunang.readFile(filePath)
      currentContent = doc.content

      if (isEditMode) {
        setEditorContent(doc.content)
      } else {
        const rendered = initRenderer(doc.content, filePath)
        viewContent.innerHTML = rendered
      }
    } catch {
      // File may have been deleted
    }
  } else if (filePath === currentFile && dirty) {
    setStatus('File changed on disk. Use F5 to reload, or save to overwrite.')
  }
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
      if (isEditMode) {
        currentContent = getEditorContent()
        const rendered = initRenderer(currentContent, currentFile || '')
        showView(rendered)
      } else {
        showEdit()
      }
      break
    case 'toggle-outline':
      toggleOutline()
      break
    case 'zoom-in':
      zoomLevel = Math.min(2.5, zoomLevel + 0.1)
      applyZoom()
      break
    case 'zoom-out':
      zoomLevel = Math.max(0.5, zoomLevel - 0.1)
      applyZoom()
      break
    case 'zoom-reset':
      zoomLevel = 1
      applyZoom()
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

window.addEventListener('beforeunload', () => {
  if (dirty) {
    // The main process handles the close prompt
    return false
  }
})
