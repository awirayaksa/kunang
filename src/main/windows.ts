import { BrowserWindow, nativeImage } from 'electron'
import { join } from 'path'
import { getThemeBackground } from './theme'
import { benchStamp } from './bench'
import { getState, markDirty } from './state'
import { attachCloseGuard } from './close-guard'
import { getAppIconPath } from './paths'

const windows = new Map<number, BrowserWindow>()
let spare: BrowserWindow | null = null
let rebuilding = false
let lastBounds: { x: number; y: number; width: number; height: number } | null = null

const DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL']
const RENDERER_DIST = join(__dirname, '../renderer/index.html')

function loadRenderer(win: BrowserWindow) {
  if (DEV_SERVER_URL) {
    win.loadURL(DEV_SERVER_URL)
  } else {
    win.loadFile(RENDERER_DIST)
  }
}

// Load saved bounds from state at module init
try {
  lastBounds = getState().bounds
} catch {}

// Decoded once. Passing a path here instead makes Electron re-read and decode
// the 7-layer .ico for every window it constructs — including the spare that
// is rebuilt while the window just handed out is still being shown, which put
// the cost squarely on the path being measured.
let appIcon: Electron.NativeImage | undefined

function getCachedAppIcon(): Electron.NativeImage | undefined {
  if (appIcon === undefined) {
    try {
      const image = nativeImage.createFromPath(getAppIconPath())
      appIcon = image.isEmpty() ? nativeImage.createEmpty() : image
    } catch {
      appIcon = nativeImage.createEmpty()
    }
  }
  return appIcon.isEmpty() ? undefined : appIcon
}

function createBrowserWindow(): BrowserWindow {
  const bg = getThemeBackground()

  const options: Electron.BrowserWindowConstructorOptions = {
    width: lastBounds?.width || 960,
    height: lastBounds?.height || 720,
    minWidth: 400,
    minHeight: 300,
    show: false,
    backgroundColor: bg,
    // Packaged, Windows takes the icon from the exe. This is what makes a dev
    // run and the portable host show the brand mark rather than Electron's.
    icon: getCachedAppIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
    title: 'kunang',
  }

  if (lastBounds?.x !== undefined && lastBounds?.y !== undefined) {
    options.x = lastBounds.x
    options.y = lastBounds.y
  }

  return new BrowserWindow(options)
}

function trackWindowBounds(win: BrowserWindow) {
  const save = () => {
    if (win.isDestroyed()) return

    const bounds = win.getBounds()
    // A maximized window's bounds are the screen, which is not a size worth
    // restoring to.
    if (!win.isMaximized() && bounds.width > 0 && bounds.height > 0) {
      lastBounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
    }

    // Debounced: resize fires continuously while the user drags an edge.
    getState().bounds = lastBounds
    markDirty()
  }

  win.on('resize', save)
  win.on('move', save)
  win.on('close', save)
}

export function initBounds() {
  try {
    lastBounds = getState().bounds
  } catch {}
}

export function createWindow(): BrowserWindow {
  const win = createBrowserWindow()
  loadRenderer(win)
  trackWindowBounds(win)
  attachCloseGuard(win)

  const id = win.id
  windows.set(id, win)

  win.on('closed', () => {
    windows.delete(id)
  })

  return win
}

export function initWarmSpare(): Promise<void> {
  return new Promise((resolve) => {
    spare = createBrowserWindow()
    loadRenderer(spare)

    spare.webContents.once('did-finish-load', () => {
      benchStamp('spare-ready')
      resolve()
    })
  })
}

function rebuildSpare() {
  if (rebuilding) return
  rebuilding = true

  const newSpare = createBrowserWindow()
  loadRenderer(newSpare)

  newSpare.webContents.once('did-finish-load', () => {
    spare = newSpare
    rebuilding = false
    benchStamp('spare-rebuilt')
  })
}

/** Whether the next open will be served from the warm pool. Read before
 *  getSpareWindow consumes it, to label a bench sample cold or warm. */
export function hasSpareWindow(): boolean {
  return spare !== null
}

export function getSpareWindow(): BrowserWindow | null {
  if (spare) {
    const win = spare
    spare = null
    windows.set(win.id, win)
    trackWindowBounds(win)
    // Only now that the spare is a real, user-visible window â€” a spare has no
    // document and nothing to lose.
    attachCloseGuard(win)

    win.on('closed', () => {
      windows.delete(win.id)
    })

    rebuildSpare()
    return win
  }

  // Fallback: create a new window (cold path)
  const win = createBrowserWindow()
  loadRenderer(win)
  trackWindowBounds(win)
  attachCloseGuard(win)
  windows.set(win.id, win)

  win.on('closed', () => {
    windows.delete(win.id)
  })

  return win
}

export function getWindow(id: number): BrowserWindow | undefined {
  return windows.get(id)
}

export function getWindows(): BrowserWindow[] {
  return Array.from(windows.values())
}
