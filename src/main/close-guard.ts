import { BrowserWindow, dialog } from 'electron'

// Closing a window with unsaved edits has to be intercepted in the main
// process: beforeunload in a renderer cannot ask a question and act on the
// answer, and the buffer only exists in the renderer.

interface DirtyState {
  /** How many documents in the window are unsaved. A window holds tabs now, so
   *  one name is no longer the whole story. */
  count: number
  fileName: string
}

/** Shared by the window prompt and the per-tab one, so closing a tab and
 *  closing a window ask the same question in the same words. */
export function unsavedPrompt(count: number, fileName: string) {
  return {
    type: 'warning' as const,
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    title: 'kunang',
    message:
      count > 1
        ? `Save changes to ${count} documents?`
        : `Save changes to ${fileName || 'this document'}?`,
    detail: 'Your changes will be lost if you do not save them.',
    noLink: true,
  }
}

const dirtyWindows = new Map<number, DirtyState>()

// Windows currently being closed on purpose, so the guard lets the second
// close() through instead of prompting again.
const forceClosing = new Set<number>()

// Renderer replies to a save request here, keyed by webContents id.
const pendingSaves = new Map<number, (ok: boolean) => void>()

const SAVE_TIMEOUT_MS = 10_000

export function setWindowDirty(windowId: number, count: number, fileName: string) {
  dirtyWindows.set(windowId, { count, fileName })
}

export function clearWindowDirty(windowId: number) {
  dirtyWindows.delete(windowId)
  forceClosing.delete(windowId)
}

export function resolveSave(webContentsId: number, ok: boolean) {
  const resolve = pendingSaves.get(webContentsId)
  if (resolve) {
    pendingSaves.delete(webContentsId)
    resolve(ok)
  }
}

function requestSave(win: BrowserWindow): Promise<boolean> {
  return new Promise((resolve) => {
    const id = win.webContents.id

    const timer = setTimeout(() => {
      // Never leave the window unclosable because the renderer went quiet.
      pendingSaves.delete(id)
      resolve(false)
    }, SAVE_TIMEOUT_MS)

    pendingSaves.set(id, (ok) => {
      clearTimeout(timer)
      resolve(ok)
    })

    win.webContents.send('request-save')
  })
}

export function attachCloseGuard(win: BrowserWindow) {
  win.on('close', (event) => {
    const id = win.id

    if (forceClosing.has(id)) return

    const state = dirtyWindows.get(id)
    if (!state || state.count === 0) return

    event.preventDefault()

    void (async () => {
      const { response } = await dialog.showMessageBox(
        win,
        unsavedPrompt(state.count, state.fileName),
      )

      if (response === 2) return // Cancel — stay open.

      if (response === 1) {
        forceClosing.add(id)
        win.close()
        return
      }

      const saved = await requestSave(win)
      if (!saved) {
        // Save failed or timed out. Keep the window open rather than closing
        // over the top of content that never reached disk.
        return
      }

      forceClosing.add(id)
      win.close()
    })()
  })

  win.on('closed', () => clearWindowDirty(win.id))
}
