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

export function onEditorChange(callback: () => void) {
  changeCallback = callback
}

function onContentChange() {
  changeCallback?.()
}

export function getEditorContent(): string {
  return editorView?.state.doc.toString() ?? ''
}

export function setEditorContent(content: string) {
  if (editorView) {
    editorView.dispatch({
      changes: { from: 0, to: editorView.state.doc.length, insert: content },
    })
  }
}

export function getEditorView(): EditorView | null {
  return editorView
}
