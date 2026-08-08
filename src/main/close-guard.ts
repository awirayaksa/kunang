import { BrowserWindow, dialog } from 'electron'

// Closing a window with unsaved edits has to be intercepted in the main
// process: beforeunload in a renderer cannot ask a question and act on the
// answer, and the buffer only exists in the renderer.

interface DirtyState {
  dirty: boolean
  fileName: string
}

const dirtyWindows = new Map<number, DirtyState>()

// Windows currently being closed on purpose, so the guard lets the second
// close() through instead of prompting again.
const forceClosing = new Set<number>()

// Renderer replies to a save request here, keyed by webContents id.
const pendingSaves = new Map<number, (ok: boolean) => void>()

const SAVE_TIMEOUT_MS = 10_000

export function setWindowDirty(windowId: number, dirty: boolean, fileName: string) {
  dirtyWindows.set(windowId, { dirty, fileName })
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
    if (!state?.dirty) return

    event.preventDefault()

    void (async () => {
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['Save', "Don't Save", 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        title: 'kunang',
        message: `Save changes to ${state.fileName || 'this document'}?`,
        detail: 'Your changes will be lost if you do not save them.',
        noLink: true,
      })

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
