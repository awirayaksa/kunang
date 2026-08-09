import { EditorView, basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { EditorState, Compartment } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

let editorView: EditorView | null = null

// Everything colour-bearing is a CSS variable from view.css, so switching
// theme repaints the editor without rebuilding it. Only the things CodeMirror
// cannot express as CSS — its dark flag and the syntax highlighting — need the
// compartment below.
const BASE_THEME = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--bg)', color: 'var(--fg)' },
  '.cm-scroller': { overflow: 'auto' },
  '.cm-content': {
    fontFamily: "'Cascadia Mono', 'Consolas', 'Courier New', monospace",
    fontSize: '14px',
    padding: '16px',
    // Fallback only: CodeMirror sets caret-color: transparent and draws
    // .cm-cursor itself, so the rule below is what actually colours the caret.
    caretColor: 'var(--caret)',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--caret)',
    borderLeftWidth: '2px',
  },
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--selection)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
  '.cm-gutters': { display: 'none' },
  // The search panel ships with light-theme defaults, which would sit as a
  // pale slab on a dark editor.
  '.cm-panels': { backgroundColor: 'var(--panel-bg)', color: 'var(--fg)' },
  '.cm-panels input, .cm-panels button': {
    backgroundColor: 'var(--bg)',
    color: 'var(--fg)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    padding: '2px 6px',
  },
  '.cm-searchMatch': { backgroundColor: 'rgba(255, 233, 168, 0.35)' },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--amber-400)',
    color: 'var(--night-900)',
  },
})

/**
 * Markdown highlighting for a dark editor.
 *
 * basicSetup's defaultHighlightStyle is tuned for a light background and its
 * blues and purples go muddy on night. Kept close to the brand: structure is
 * carried by weight and amber, not by a spread of hues.
 */
const DARK_HIGHLIGHT = HighlightStyle.define(
  [
    { tag: tags.heading, color: '#FFD980', fontWeight: 'bold' },
    { tag: tags.strong, color: '#F6F4EF', fontWeight: 'bold' },
    { tag: tags.emphasis, color: '#F6F4EF', fontStyle: 'italic' },
    { tag: tags.strikethrough, textDecoration: 'line-through' },
    { tag: tags.link, color: '#FFC247', textDecoration: 'underline' },
    { tag: tags.url, color: '#9AA3B8' },
    { tag: tags.monospace, color: '#FFD980' },
    { tag: tags.quote, color: '#9AA3B8', fontStyle: 'italic' },
    { tag: tags.list, color: '#FFC247' },
    // The syntax markers themselves (#, *, backticks) recede.
    { tag: tags.processingInstruction, color: '#5C6A8A' },
    { tag: tags.contentSeparator, color: '#5C6A8A' },
  ],
  { themeType: 'dark' },
)

const themeMode = new Compartment()

function themeExtensions(dark: boolean) {
  // Light needs nothing: basicSetup's defaultHighlightStyle is registered with
  // fallback: true, so it applies exactly when no other style is active.
  return dark ? [EditorView.theme({}, { dark: true }), syntaxHighlighting(DARK_HIGHLIGHT)] : []
}

/** Repaint the editor for a theme change without losing document or cursor. */
export function setEditorTheme(dark: boolean) {
  editorView?.dispatch({
    effects: themeMode.reconfigure(themeExtensions(dark)),
  })
}

/**
 * A fresh editor state for one document.
 *
 * Factored out of initEditor so every tab's state is built from the same
 * extension list — swapping a state built with a different configuration into
 * a live view silently drops whichever extensions the two do not share.
 */
export function makeState(doc: string, dark: boolean): EditorState {
  return EditorState.create({
    doc,
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
      BASE_THEME,
      themeMode.of(themeExtensions(dark)),
    ],
  })
}

export function initEditor(dark: boolean): EditorView {
  const container = document.getElementById('editor-container')!
  if (editorView) {
    editorView.destroy()
  }

  editorView = new EditorView({
    state: makeState('', dark),
    parent: container,
  })

  return editorView
}

/**
 * Show another tab's document, keeping the live view.
 *
 * setState rather than a new EditorView: the state carries its own undo
 * history and selection, so switching away and back leaves the cursor and
 * Ctrl+Z exactly where the user left them. Rebuilding the view would discard
 * both and re-run CodeMirror's whole construction cost per switch.
 */
export function swapEditorState(state: EditorState) {
  if (!editorView) return

  // setState fires the update listener for the document it installs. That is
  // not a user edit, and treating it as one marks the incoming tab dirty the
  // moment it is looked at.
  applyingProgrammaticEdit = true
  try {
    editorView.setState(state)
  } finally {
    applyingProgrammaticEdit = false
  }
}

/** The live state, to be stowed against the outgoing tab before a switch. */
export function getEditorState(): EditorState | null {
  return editorView?.state ?? null
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
