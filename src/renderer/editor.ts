import { EditorView, basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'

let editorView: EditorView | null = null

export function initEditor(): EditorView {
  const container = document.getElementById('editor-container')!
  if (editorView) {
    editorView.destroy()
  }

  editorView = new EditorView({
    state: EditorState.create({
      doc: '',
      extensions: [
        basicSetup,
        markdown(),
        keymap.of([indentWithTab]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onContentChange()
          }
        }),
        EditorView.theme({
          '&': { height: '100%' },
          '.cm-scroller': { overflow: 'auto' },
          '.cm-content': { fontFamily: "'Cascadia Mono', 'Consolas', 'Courier New', monospace", fontSize: '14px', padding: '16px' },
          '.cm-gutters': { display: 'none' },
        }),
      ],
    }),
    parent: container,
  })

  return editorView
}

let changeCallback: (() => void) | null = null

// Set while we are replacing the document ourselves. changeCallback is module
// state that outlives any single editor instance, so without this a reload —
// or simply entering edit mode a second time — fired the previous callback
// and marked the buffer dirty when the user had typed nothing.
let applyingProgrammaticEdit = false

export function onEditorChange(callback: () => void) {
  changeCallback = callback
}

function onContentChange() {
  if (applyingProgrammaticEdit) return
  changeCallback?.()
}

export function getEditorContent(): string {
  return editorView?.state.doc.toString() ?? ''
}

export function setEditorContent(content: string) {
  if (!editorView) return

  // dispatch is synchronous, so the flag reliably brackets the update
  // listener that it triggers.
  applyingProgrammaticEdit = true
  try {
    editorView.dispatch({
      changes: { from: 0, to: editorView.state.doc.length, insert: content },
    })
  } finally {
    applyingProgrammaticEdit = false
  }
}

export function getEditorView(): EditorView | null {
  return editorView
}

/** Insert text at the cursor, replacing any selection. Deliberately not
 *  bracketed by the programmatic-edit flag: this is a user action and should
 *  mark the buffer dirty. */
export function insertAtCursor(text: string) {
  if (!editorView) return

  const { from, to } = editorView.state.selection.main
  editorView.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
  })
  editorView.focus()
}
