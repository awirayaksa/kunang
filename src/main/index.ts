import { app, BrowserWindow } from 'electron'
import { existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getDataDir, writeHostPointer } from './paths'
import { start as startPipeServer } from './pipe'
import { initWarmSpare, getSpareWindow, getTargetWindow, getWindows, hasSpareWindow } from './windows'
import { initBench, beginOpen, markDispatch, isBenchEnabled } from './bench'
import { takeRestorePaths } from './session'
import { registerProtocol } from './protocol'
import { registerIpcHandlers } from './ipc'
import { buildMenu } from './menu'
import { getState, flushStateSync } from './state'
import { initTheme } from './theme'
import { closeAllWatchers, setWatchSink } from './watcher'

app.setAppUserModelId('com.kunang.app')

/**
 * Which window serves the next open.
 *
 * Normally the one the user was last looking at, which gains a tab. Under
 * --bench it is always a fresh window: paint-done closes each measured window
 * (ipc.ts), so reusing one would make every sample after the first cold and
 * turn the warm-open gate into noise.
 */
function openTarget(): { win: BrowserWindow | null; reused: boolean } {
  if (isBenchEnabled()) return { win: getSpareWindow(), reused: false }
  return getTargetWindow()
}

/** Hand a brand-new window the previous session's documents, ahead of the file
 *  that caused it to exist. They arrive as empty tabs and are read only if the
 *  user goes back to one, so a large session costs nothing here. */
function sendRestore(win: BrowserWindow, reused: boolean) {
  if (reused || isBenchEnabled()) return

  const paths = takeRestorePaths()
  if (paths.length > 0) win.webContents.send('restore-tabs', { paths })
}

app.whenReady().then(async () => {
  if (process.argv.includes('--bench')) {
    initBench(getDataDir())
  }

  initTheme(getState().theme)

  // Watcher events reach the renderer through here; the watcher module itself
  // knows nothing about Electron.
  setWatchSink((channel, payload) => {
    for (const win of getWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload)
      }
    }
  })

  // Record where we live so the stub's self-healing spawn can find us â€” it has
  // no other way to locate the host once it is registered from the data dir.
  try {
    writeHostPointer()
  } catch (err) {
    console.error('Failed to write host pointer:', err)
  }

  startPipeServer((payload) => {
    // Remote control channel: the stub forwards its argv, so a second
    // invocation can ask the resident host to exit. Running --quit in a new
    // process could never do this â€” that process loses the pipe election and
    // quits itself, leaving the actual host untouched.
    if (payload.argv.includes('--quit')) {
      app.quit()
      return
    }

    const fileArgv = payload.argv.filter(a => !a.startsWith('--'))
    const file = fileArgv.length > 0 ? fileArgv[0] : null

    const hadSpare = hasSpareWindow()
    const target = openTarget()
    const win = target.win
    if (!win) return

    if (target.reused) {
      // Already on screen, so nothing downstream will raise it — paint-done
      // only shows a window that is still hidden.
      if (win.isMinimized()) win.restore()
      win.focus()
    }

    beginOpen(win.webContents.id, payload.t0, !target.reused && !hadSpare)
    sendRestore(win, target.reused)
    win.webContents.send('load', { file, cwd: payload.cwd, t0: payload.t0 })
    markDispatch(win.webContents.id)
  })

  registerProtocol()
  registerIpcHandlers()
  buildMenu()

  await initWarmSpare()

  // Portable first run: the host is now fully warm, so registering the .md
  // handler can only ever point at a host that is ready to answer.
  if (process.argv.includes('--portable')) {
    const marker = join(getDataDir(), 'registered')
    if (!existsSync(marker)) {
      try {
        const { installAssociationsOnly } = await import('./install')
        installAssociationsOnly()
        writeFileSync(marker, new Date().toISOString(), 'utf8')
      } catch (err) {
        console.error('Portable registration failed:', err)
      }
    }
  }

  // If launched with file args directly (not via stub), handle them
  const fileArg = process.argv.find(a => !a.startsWith('-') && a !== __filename)
  if (fileArg && process.argv.includes('--preload')) {
    // Launched by stub's self-healing spawn; stub will send payload separately
  } else if (fileArg) {
    const target = openTarget()
    if (target.win) {
      sendRestore(target.win, target.reused)
      target.win.webContents.send('load', { file: fileArg, cwd: process.cwd(), t0: 0 })
    }
  }
})

app.on('window-all-closed', () => {
  // Do nothing â€” host survives
})

app.on('before-quit', () => {
  // Synchronous: an async write queued here would never run, because the
  // event loop stops as soon as this handler returns.
  flushStateSync()
  closeAllWatchers()
})

// --quit is handled off the pipe, above. Doing it here as well would only ever
// have quit this process, which loses the pipe election and exits anyway,
// leaving the resident host running.

// --install / --uninstall
const installIndex = process.argv.indexOf('--install')
if (installIndex >= 0) {
  app.whenReady().then(async () => {
    const { install } = await import('./install')
    install()
  })
}

const uninstallIndex = process.argv.indexOf('--uninstall')
if (uninstallIndex >= 0) {
  app.whenReady().then(async () => {
    const { uninstall } = await import('./install')
    uninstall()
  })
}
