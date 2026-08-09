import { promises as fs, readFileSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface AppState {
  theme: 'auto' | 'light' | 'dark'
  idleTimeoutMinutes: number
  scrollPositions: Record<string, number>
  bounds: { x: number; y: number; width: number; height: number } | null
  /** Documents that were open when the host last had windows, oldest first.
   *  One flat list rather than a per-window layout: the host is resident and
   *  windowless most of the time, so there is no moment at which restoring a
   *  window arrangement would be the right thing to do. */
  session: string[]
}

// Resolved lazily, and Electron is only required if LOCALAPPDATA is missing.
// That keeps this module importable outside the app, so the pure helpers below
// can be tested without booting Electron.
function appDataDir(): string {
  const local = process.env.LOCALAPPDATA
  if (local) return join(local, 'kunang')

  const { app } = require('electron')
  return join(app.getPath('userData'), 'kunang')
}

function statePath(): string {
  return join(appDataDir(), 'state.json')
}

// Scroll positions accumulate one entry per file ever opened. Cap the map so
// state.json cannot grow without bound on a host that stays resident for weeks.
const MAX_SCROLL_ENTRIES = 200

// Writes are debounced: window resize fires continuously while dragging, and
// each event used to cost a synchronous read plus a write.
const FLUSH_DELAY_MS = 500

// A session is capped for the same reason scroll positions are: a resident
// host lives for weeks, and a restore that opened hundreds of tabs would be a
// worse outcome than losing the tail of the list.
const MAX_SESSION_PATHS = 50

function defaults(): AppState {
  return { theme: 'auto', idleTimeoutMinutes: 0, scrollPositions: {}, bounds: null, session: [] }
}

/**
 * Keep only what is actually a list of paths.
 *
 * Exported for testing, and defensive on purpose: state.json is a plain file a
 * user may edit, and a malformed session must degrade to "no tabs restored"
 * rather than throwing on a path that turns out to be a number.
 */
export function sanitizeSession(value: unknown, max: number = MAX_SESSION_PATHS): string[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry === 'string' && entry.length > 0) seen.add(entry)
  }

  // Keep the tail: those are the most recently open.
  return Array.from(seen).slice(-max)
}

export function loadState(): AppState {
  try {
    const parsed = JSON.parse(readFileSync(statePath(), 'utf8'))
    return {
      theme: parsed.theme || 'auto',
      idleTimeoutMinutes: parsed.idleTimeoutMinutes || 0,
      scrollPositions: parsed.scrollPositions || {},
      bounds: parsed.bounds || null,
      session: sanitizeSession(parsed.session),
    }
  } catch {
    return defaults()
  }
}

export function setSession(paths: string[]) {
  getState().session = sanitizeSession(paths)
  markDirty()
}

export async function saveState(state: AppState): Promise<void> {
  try {
    await fs.mkdir(appDataDir(), { recursive: true })
    await fs.writeFile(statePath(), JSON.stringify(state, null, 2), 'utf8')
  } catch (err) {
    console.error('Failed to save state:', err)
  }
}

let cached: AppState | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null

/** The single in-memory copy of state. Read it, mutate it, then markDirty(). */
export function getState(): AppState {
  if (!cached) cached = loadState()
  return cached
}

export function markDirty() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    if (cached) void saveState(cached)
  }, FLUSH_DELAY_MS)
}

/** Write immediately and synchronously — for before-quit, where the event
 *  loop stops before any pending async write would run. */
export function flushStateSync() {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (!cached) return
  try {
    mkdirSync(appDataDir(), { recursive: true })
    writeFileSync(statePath(), JSON.stringify(cached, null, 2), 'utf8')
  } catch (err) {
    console.error('Failed to flush state:', err)
  }
}

export function getScrollPosition(filePath: string): number {
  return getState().scrollPositions[filePath] ?? 0
}

/**
 * Record a scroll position, evicting the least recently touched entries once
 * the map exceeds `max`.
 *
 * Pure and exported so the eviction order can be tested directly — string keys
 * on a plain object iterate in insertion order, which is what makes deleting
 * before re-inserting behave as an LRU.
 */
export function recordScroll(
  positions: Record<string, number>,
  filePath: string,
  y: number,
  max: number = MAX_SCROLL_ENTRIES,
): Record<string, number> {
  delete positions[filePath]
  positions[filePath] = y

  const keys = Object.keys(positions)
  for (const stale of keys.slice(0, Math.max(0, keys.length - max))) {
    delete positions[stale]
  }

  return positions
}

export function setScrollPosition(filePath: string, y: number) {
  const state = getState()
  state.scrollPositions = recordScroll(state.scrollPositions, filePath, y)
  markDirty()
}
