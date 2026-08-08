import { watch, FSWatcher } from 'chokidar'
import { dirname, basename } from 'path'
import { getWindows } from './windows'

const watchers = new Map<string, FSWatcher>()
const suppressedPaths = new Map<string, number>()

export function watchDirectory(dir: string) {
  if (watchers.has(dir)) return

  const watcher = watch(dir, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    depth: 0,
  })

  watcher.on('change', (filePath: string) => {
    const suppressUntil = suppressedPaths.get(filePath)
    if (suppressUntil && Date.now() < suppressUntil) {
      return
    }

    // Notify all windows that might have this file open
    for (const win of getWindows()) {
      win.webContents.send('file-changed', { path: filePath })
    }
  })

  watchers.set(dir, watcher)
}

export function suppressNextReload(filePath: string, durationMs = 2000) {
  suppressedPaths.set(filePath, Date.now() + durationMs)
}

export function initWatcher() {
  // Initialized; watchers are created per-directory on first open
}

export function closeWatcher(dir: string) {
  const watcher = watchers.get(dir)
  if (watcher) {
    watcher.close()
    watchers.delete(dir)
  }
}
