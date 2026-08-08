import { EditorView } from 'codemirror'
import { getEditorView } from './editor'

let syncing = false

export function initSync() {
  const editorView = getEditorView()
  const previewPane = document.getElementById('preview-pane')

  if (!editorView || !previewPane) return

  // When editor scrolls, sync preview
  editorView.scrollDOM.addEventListener('scroll', () => {
    if (syncing) return
    syncing = true

    const editorScroll = editorView.scrollDOM
    const editorRatio = editorScroll.scrollTop / (editorScroll.scrollHeight - editorScroll.clientHeight)

    const lineBlocks = previewPane.querySelectorAll('[data-line]')
    if (lineBlocks.length === 0) {
      syncing = false
      return
    }

    // Find the block whose data-line corresponds to the visible editor line
    const editorTopLine = editorView.viewportLineBlocks[0]?.from
    if (editorTopLine === undefined) {
      syncing = false
      return
    }

    const editorLine = editorView.state.doc.lineAt(editorTopLine)?.number ?? 0

    let targetBlock: Element | null = null
    for (const block of lineBlocks) {
      const line = parseInt(block.getAttribute('data-line') || '0', 10)
      if (line <= editorLine) {
        targetBlock = block
      } else {
        break
      }
    }

    if (targetBlock) {
      const rect = targetBlock.getBoundingClientRect()
      const containerRect = previewPane.getBoundingClientRect()
      const offset = rect.top - containerRect.top
      previewPane.scrollTop += offset - 80 // 80px padding from top
    }

    setTimeout(() => { syncing = false }, 50)
  })

  // When preview scrolls, sync editor (bidirectional)
  previewPane.addEventListener('scroll', () => {
    if (syncing) return
    syncing = true

    const elements = previewPane.querySelectorAll('[data-line]')
    if (elements.length === 0) {
      syncing = false
      return
    }

    const containerRect = previewPane.getBoundingClientRect()
    const viewportCenter = containerRect.top + containerRect.height / 2

    let targetLine = 0
    for (const el of elements) {
      const rect = el.getBoundingClientRect()
      if (rect.top <= viewportCenter) {
        targetLine = parseInt(el.getAttribute('data-line') || '0', 10)
      } else {
        break
      }
    }

    if (targetLine > 0) {
      try {
        const pos = editorView.state.doc.line(targetLine).from
        editorView.dispatch({
          effects: EditorView.scrollIntoView(pos, { y: 'start' }),
        })
      } catch {}
    }

    setTimeout(() => { syncing = false }, 50)
  })
}
