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

/**
 * Move the tab at `from` so that it ends up at `to`, and say where the active
 * document went.
 *
 * `to` is a position in the resulting array — where the tab lands once it has
 * been lifted out — not a gap in the original. A drop point is a gap, so the
 * caller converts with `slotToIndex` first; keeping the two apart is what
 * stops the off-by-one from living in here.
 */
export function moveTab(
  tabs: TabData[],
  from: number,
  to: number,
  activeIndex: number,
): { tabs: TabData[]; activeIndex: number } {
  if (from < 0 || from >= tabs.length) return { tabs, activeIndex }

  const dest = Math.max(0, Math.min(to, tabs.length - 1))
  // Same array back when nothing moved, so the caller can skip the repaint.
  if (dest === from) return { tabs, activeIndex }

  const next = tabs.slice()
  const [moved] = next.splice(from, 1)
  next.splice(dest, 0, moved)

  if (activeIndex < 0 || activeIndex >= tabs.length) return { tabs: next, activeIndex }

  // Follow the id rather than adjusting the index: every tab between `from`
  // and `dest` shifts by one, and which way depends on the direction of the
  // move. The active document has not changed, only where it sits.
  return { tabs: next, activeIndex: findById(next, tabs[activeIndex].id) }
}

/**
 * Convert an insertion gap into a destination index for `moveTab`.
 *
 * A drop reports the gap it landed in — `slot` is "before the tab currently at
 * this position", and runs 0..length. Dropping into a gap to the right of the
 * dragged tab lands one position lower than the gap number, because the tab
 * itself is removed from the list before it is put back.
 */
export function slotToIndex(slot: number, from: number): number {
  return slot > from ? slot - 1 : slot
}
