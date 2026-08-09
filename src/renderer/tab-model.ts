// The tab list, as data. No DOM, no CodeMirror — everything here is pure, so
// the rules that are easy to get wrong (which tab takes over when the active
// one closes, wrap-around order) can be tested without a browser.
//
// The live CodeMirror EditorState for each tab is held alongside this array in
// tabs.ts rather than inside TabData, which is what keeps this module free of
// anything that cannot run under tsx.

export interface TabData {
  /** Stable across reordering and index shifts, unlike the array position. */
  id: number
  /** null until the buffer has been saved somewhere — an untitled document. */
  path: string | null
  /** False for a tab restored from the previous session: it knows its path and
   *  nothing else until it is first activated. Reading every restored document
   *  up front would put a session's worth of file I/O on the open path. */
  loaded: boolean
  /** Content as last loaded or saved. In edit mode the editor is the truth
   *  until the tab is deactivated, which writes back to here. */
  content: string
  dirty: boolean
  fileMissing: boolean
  isEditMode: boolean
  viewScrollTop: number
  /** Rendered HTML, so switching back to a tab does not re-run markdown-it.
   *  null means stale — the next activation must render again. */
  viewHTML: string | null
  remoteAllowed: boolean
}

export function createTab(id: number, path: string | null): TabData {
  return {
    id,
    path,
    loaded: false,
    content: '',
    dirty: false,
    fileMissing: false,
    isEditMode: false,
    viewScrollTop: 0,
    viewHTML: null,
    remoteAllowed: false,
  }
}

/** Index of the tab holding `path`, or -1. Opening a file that is already open
 *  activates it rather than making a second copy of the same document. */
export function findByPath(tabs: TabData[], path: string): number {
  return tabs.findIndex((t) => t.path === path)
}

export function findById(tabs: TabData[], id: number): number {
  return tabs.findIndex((t) => t.id === id)
}

/**
 * Remove the tab at `index` and say which one should become active.
 *
 * Successor is the tab to the right, or the left when the closed tab was last —
 * the rule every tabbed editor uses, and the reason this is worth testing: the
 * naive `min(index, length - 1)` gets the last-tab case right by accident and
 * the active-index-above-the-closed-one case wrong.
 */
export function closeAt(
  tabs: TabData[],
  index: number,
  activeIndex: number,
): { tabs: TabData[]; activeIndex: number } {
  if (index < 0 || index >= tabs.length) return { tabs, activeIndex }

  const next = tabs.slice(0, index).concat(tabs.slice(index + 1))
  if (next.length === 0) return { tabs: next, activeIndex: -1 }

  // Closing a tab left of the active one shifts it down without changing which
  // document the user is looking at.
  if (index < activeIndex) return { tabs: next, activeIndex: activeIndex - 1 }
  if (index > activeIndex) return { tabs: next, activeIndex }

  return { tabs: next, activeIndex: Math.min(index, next.length - 1) }
}

/** Next/previous position, wrapping at both ends. */
export function stepIndex(count: number, active: number, delta: number): number {
  if (count <= 0) return -1
  return (((active + delta) % count) + count) % count
}
