import { existsSync } from 'fs'
import { getState, setSession } from './state'
import { closeDocument } from './document'

// Which documents each window has open, and which were open the last time the
// host had any windows at all.
//
// The host is resident and windowless most of the time, so there is no point
// at which restoring a saved window layout would be right — a logon-warmed
// host would pop windows open at the desktop. Instead the saved list is handed
// to the first window built after the host starts, which by construction only
// happens because the user asked to open something.

let restoreConsumed = false

/**
 * The previous session's documents, once.
 *
 * Paths that have since been deleted are dropped rather than reported: a tab
 * that cannot be read is worse than a tab that never came back.
 */
export function takeRestorePaths(): string[] {
  if (restoreConsumed) return []
  restoreConsumed = true

  return getState().session.filter((path) => {
    try {
      return existsSync(path)
    } catch {
      return false
    }
  })
}

const openByWindow = new Map<number, string[]>()

function allOpenPaths(): Set<string> {
  const out = new Set<string>()
  for (const paths of openByWindow.values()) {
    for (const path of paths) out.add(path)
  }
  return out
}

/** Drop the cached document and its watcher for anything no window holds any
 *  more. Until tabs existed nothing ever called closeDocument, because a
 *  window only ever had one document and closing it closed the window. */
function reconcile(before: Set<string>) {
  const after = allOpenPaths()

  for (const path of before) {
    if (!after.has(path)) closeDocument(path)
  }

  // An empty set means the last window just closed. Persisting that would
  // erase the very session the next open is meant to restore.
  if (after.size > 0) setSession(Array.from(after))
}

export function setWindowPaths(windowId: number, paths: string[]) {
  const before = allOpenPaths()
  openByWindow.set(windowId, paths)
  reconcile(before)
}

export function forgetWindow(windowId: number) {
  if (!openByWindow.has(windowId)) return

  const before = allOpenPaths()
  openByWindow.delete(windowId)
  reconcile(before)
}
