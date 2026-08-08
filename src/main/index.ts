import { app, BrowserWindow } from 'electron'
import { existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getDataDir, writeHostPointer } from './paths'
import { start as startPipeServer } from './pipe'
import { initWarmSpare, getSpareWindow, getWindows, hasSpareWindow } from './windows'
import { initBench, beginOpen, markDispatch } from './bench'
import { registerProtocol } from './protocol'
import { registerIpcHandlers } from './ipc'
import { buildMenu } from './menu'
import { getState, flushStateSync } from './state'
import { initTheme } from './theme'
import { closeAllWatchers, setWatchSink } from './watcher'

app.setAppUserModelId('com.kunang.app')

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

  // Record where we live so the stub's self-healing spawn can find us — it has
  // no other way to locate the host once it is registered from the data dir.
  try {
    writeHostPointer()
  } catch (err) {
    console.error('Failed to write host pointer:', err)
  }

  startPipeServer((payload) => {
    // Remote control channel: the stub forwards its argv, so a second
    // invocation can ask the resident host to exit. Running --quit in a new
    // process could never do this — that process loses the pipe election and
    // quits itself, leaving the actual host untouched.
    if (payload.argv.includes('--quit')) {
      app.quit()
      return
    }

    const hadSpare = hasSpareWindow()
    const win = getSpareWindow()
    if (!win) return

    const fileArgv = payload.argv.filter(a => !a.startsWith('--'))
    const file = fileArgv.length > 0 ? fileArgv[0] : null

    beginOpen(win.webContents.id, payload.t0, !hadSpare)
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
    const win = getSpareWindow()
    if (win) {
      win.webContents.send('load', { file: fileArg, cwd: process.cwd(), t0: 0 })
    }
  }
})

app.on('window-all-closed', () => {
  // Do nothing — host survives
})

app.on('before-quit', () => {
  // Synchronous: an async write queued here would never run, because the
  // event loop stops as soon as this handler returns.
  flushStateSync()
  closeAllWatchers()
})

// --quit command line
const quitIndex = process.argv.indexOf('--quit')
if (quitIndex >= 0) {
  app.whenReady().then(() => {
    app.quit()
  })
}

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
