import { watch, FSWatcher } from 'chokidar'
import { dirname } from 'path'

// The sink is injected rather than importing ./windows directly. That keeps
// this module free of any Electron dependency, so the watch semantics below
// can be tested against a real directory without booting the app.
type WatchSink = (channel: string, payload: unknown) => void

let sink: WatchSink = () => {}

export function setWatchSink(fn: WatchSink) {
  sink = fn
}

// Watchers are per-directory with depth 0: watching each file individually
// would miss the unlink/add pair that a rename shows up as.
const watchers = new Map<string, FSWatcher>()

// Only paths that are actually open in a window are interesting. Without this
// every unrelated file touched in the same directory would raise events.
const tracked = new Set<string>()

const suppressedPaths = new Map<string, number>()

// A resident host can be alive for days. Cap the watcher set so browsing
// through many directories does not accumulate handles without bound.
const MAX_WATCHED_DIRS = 32

// Windows reports a rename as unlink-then-add with no relationship between
// them, so pair them by proximity in time within the same directory. This is a
// heuristic: deleting one file and creating another within the window looks
// identical to a rename. It errs toward following the file, which is the
// recoverable direction — the alternative is claiming the document vanished.
const RENAME_WINDOW_MS = 300
const pendingUnlinks = new Map<string, ReturnType<typeof setTimeout>>()

function broadcast(channel: string, payload: unknown) {
  sink(channel, payload)
}

function onChange(filePath: string) {
  if (!tracked.has(filePath)) return

  const suppressUntil = suppressedPaths.get(filePath)
  if (suppressUntil && Date.now() < suppressUntil) return

  broadcast('file-changed', { path: filePath })
}

function onUnlink(filePath: string) {
  if (!tracked.has(filePath)) return
  if (pendingUnlinks.has(filePath)) return

  const timer = setTimeout(() => {
    pendingUnlinks.delete(filePath)
    tracked.delete(filePath)
    broadcast('file-removed', { path: filePath })
  }, RENAME_WINDOW_MS)

  pendingUnlinks.set(filePath, timer)
}

function onAdd(filePath: string) {
  const dir = dirname(filePath)

  for (const [oldPath, timer] of pendingUnlinks) {
    if (dirname(oldPath) !== dir) continue

    clearTimeout(timer)
    pendingUnlinks.delete(oldPath)
    tracked.delete(oldPath)
    tracked.add(filePath)
    broadcast('file-renamed', { from: oldPath, to: filePath })
    return
  }
}

export function watchDirectory(dir: string) {
  if (watchers.has(dir)) return

  if (watchers.size >= MAX_WATCHED_DIRS) {
    const oldest = watchers.keys().next().value
    if (oldest) closeWatcher(oldest)
  }

  const watcher = watch(dir, {
    ignoreInitial: true,
    // Saves are not atomic from the watcher's point of view; wait for the
    // write to settle or we render a half-written file.
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    depth: 0,
  })

  watcher.on('change', onChange)
  watcher.on('unlink', onUnlink)
  watcher.on('add', onAdd)
  watcher.on('error', () => {
    // A watch failing (permissions, unmounted network share) must not take
    // the host down. The document stays open, just without live reload.
  })

  watchers.set(dir, watcher)
}

/** Start watching the directory holding filePath, and mark it as open. */
export function trackFile(filePath: string) {
  tracked.add(filePath)
  watchDirectory(dirname(filePath))
}

export function untrackFile(filePath: string) {
  tracked.delete(filePath)
  const timer = pendingUnlinks.get(filePath)
  if (timer) {
    clearTimeout(timer)
    pendingUnlinks.delete(filePath)
  }
}

/** Ignore change events for a path briefly — used around our own writes. */
export function suppressNextReload(filePath: string, durationMs = 2000) {
  suppressedPaths.set(filePath, Date.now() + durationMs)
}

export function closeWatcher(dir: string) {
  const watcher = watchers.get(dir)
  if (watcher) {
    watcher.close()
    watchers.delete(dir)
  }
}

export function closeAllWatchers() {
  for (const dir of Array.from(watchers.keys())) {
    closeWatcher(dir)
  }
}
