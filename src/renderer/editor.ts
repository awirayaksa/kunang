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
        // Brand palette — see resources/BRAND.md. The source pane is night
        // with paper text, and the caret is amber-400: it is the one moving
        // amber element in the interface, and that restraint is the point.
        EditorView.theme(
          {
            '&': { height: '100%', backgroundColor: '#070B16', color: '#F6F4EF' },
            '.cm-scroller': { overflow: 'auto' },
            '.cm-content': {
              fontFamily: "'Cascadia Mono', 'Consolas', 'Courier New', monospace",
              fontSize: '14px',
              padding: '16px',
              // Fallback only: CodeMirror sets caret-color: transparent and
              // draws .cm-cursor itself, so the rule below is the one that
              // actually colours the caret.
              caretColor: '#FFC247',
            },
            '.cm-cursor, .cm-dropCursor': {
              borderLeftColor: '#FFC247',
              borderLeftWidth: '2px',
            },
            '&.cm-focused': { outline: 'none' },
            '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
              backgroundColor: '#1B2542',
            },
            '.cm-activeLine': { backgroundColor: 'rgba(255, 233, 168, 0.05)' },
            '.cm-gutters': { display: 'none' },
            // The search panel ships with light-theme defaults that would sit
            // as a white slab on the night pane.
            '.cm-panels': { backgroundColor: '#0E1426', color: '#F6F4EF' },
            '.cm-panels input, .cm-panels button': {
              backgroundColor: '#070B16',
              color: '#F6F4EF',
              border: '1px solid #1B2542',
              borderRadius: '4px',
              padding: '2px 6px',
            },
            '.cm-searchMatch': { backgroundColor: 'rgba(255, 233, 168, 0.35)' },
            '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#FFC247', color: '#070B16' },
          },
          { dark: true },
        ),
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
