import { EditorView } from 'codemirror'
import { getEditorView } from './editor'

let syncing = false

// #preview-pane is a fixed element in index.html, so it survives every edit
// mode toggle. initSync used to attach a fresh scroll listener to it on each
// toggle, multiplying the handlers and leaking them for the life of the
// window.
let previewListenerAttached = false

// The editor has the same problem now that one EditorView serves every tab:
// its scrollDOM outlives a tab switch, so track which view we are attached to
// rather than assuming a fresh one each time.
let attachedEditor: EditorView | null = null

/** Suppress the opposite pane's scroll handler while we drive it. */
function beginSync(): boolean {
  if (syncing) return false
  syncing = true
  return true
}

function endSync() {
  setTimeout(() => {
    syncing = false
  }, 50)
}

function onEditorScroll() {
  const editorView = getEditorView()
  const previewPane = document.getElementById('preview-pane')
  if (!editorView || !previewPane) return
  if (!beginSync()) return

  const blocks = previewPane.querySelectorAll('[data-line]')
  if (blocks.length === 0) {
    syncing = false
    return
  }

  const topPos = editorView.viewportLineBlocks[0]?.from
  if (topPos === undefined) {
    syncing = false
    return
  }

  const editorLine = editorView.state.doc.lineAt(topPos).number

  let target: Element | null = null
  for (const block of blocks) {
    const line = parseInt(block.getAttribute('data-line') || '0', 10)
    if (line <= editorLine) {
      target = block
    } else {
      break
    }
  }

  if (target) {
    const offset = target.getBoundingClientRect().top - previewPane.getBoundingClientRect().top
    previewPane.scrollTop += offset - 80
  }

  endSync()
}

function onPreviewScroll() {
  const editorView = getEditorView()
  const previewPane = document.getElementById('preview-pane')
  if (!editorView || !previewPane) return
  if (!beginSync()) return

  const elements = previewPane.querySelectorAll('[data-line]')
  if (elements.length === 0) {
    syncing = false
    return
  }

  const containerRect = previewPane.getBoundingClientRect()
  const viewportCenter = containerRect.top + containerRect.height / 2

  let targetLine = 0
  for (const el of elements) {
    if (el.getBoundingClientRect().top <= viewportCenter) {
      targetLine = parseInt(el.getAttribute('data-line') || '0', 10)
    } else {
      break
    }
  }

  if (targetLine > 0) {
    try {
      const pos = editorView.state.doc.line(targetLine).from
      editorView.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'start' }) })
    } catch {
      // data-line can outrun the document mid-edit; the next scroll corrects it.
    }
  }

  endSync()
}

export function initSync() {
  const editorView = getEditorView()
  const previewPane = document.getElementById('preview-pane')
  if (!editorView || !previewPane) return

  if (attachedEditor !== editorView) {
    editorView.scrollDOM.addEventListener('scroll', onEditorScroll)
    attachedEditor = editorView
  }

  if (!previewListenerAttached) {
    previewPane.addEventListener('scroll', onPreviewScroll)
    previewListenerAttached = true
  }
}
