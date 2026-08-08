import { performance } from 'perf_hooks'
import { appendFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'

// Per-open timing for the double-click path. Samples are appended as JSON
// lines so scripts/bench.mjs can read them back: the resident host has no
// console anyone can see, so printing them would be printing into the void.

export interface OpenSample {
  /** Stub entry, epoch ms. Everything else is an offset from it. */
  t0: number
  /** Stub entry -> main parsed the pipe payload. */
  pipe: number
  /** -> main handed the payload to a renderer. */
  dispatch: number
  /** -> renderer reported it had painted. */
  paint: number
  /** -> window actually on screen. */
  show: number
  /** True when no warm spare was available and a window had to be built. */
  cold: boolean
}

interface Pending {
  t0: number
  pipe: number
  dispatch: number
  paint: number
  cold: boolean
}

let enabled = false
let outPath = ''
const pending = new Map<number, Pending>()

/** Epoch milliseconds with sub-millisecond resolution. Date.now() is only
 *  accurate to ~1ms, which is a large fraction of the budget being measured. */
function nowEpochMs(): number {
  return performance.timeOrigin + performance.now()
}

export function isBenchEnabled(): boolean {
  return enabled
}

export function initBench(dataDir: string) {
  enabled = true
  outPath = join(dataDir, 'bench.jsonl')

  try {
    mkdirSync(dataDir, { recursive: true })
    // Fresh file per host, so a run cannot be polluted by an earlier one.
    rmSync(outPath, { force: true })
  } catch {
    // Non-fatal: the run just produces no file, and the runner says so.
  }
}

export function beginOpen(webContentsId: number, t0UnixNano: number, cold: boolean) {
  if (!enabled) return

  const t0 = t0UnixNano / 1_000_000
  pending.set(webContentsId, { t0, pipe: nowEpochMs() - t0, dispatch: 0, paint: 0, cold })
}

export function markDispatch(webContentsId: number) {
  const p = pending.get(webContentsId)
  if (p) p.dispatch = nowEpochMs() - p.t0
}

export function markPaint(webContentsId: number) {
  const p = pending.get(webContentsId)
  if (p) p.paint = nowEpochMs() - p.t0
}

export function completeOpen(webContentsId: number) {
  const p = pending.get(webContentsId)
  if (!p) return
  pending.delete(webContentsId)

  const sample: OpenSample = {
    t0: p.t0,
    pipe: p.pipe,
    dispatch: p.dispatch,
    paint: p.paint,
    show: nowEpochMs() - p.t0,
    cold: p.cold,
  }

  try {
    appendFileSync(outPath, JSON.stringify(sample) + '\n', 'utf8')
  } catch (err) {
    console.error('bench: failed to append sample', err)
  }
}

/** Legacy one-shot marker used for spare lifecycle logging. */
export function benchStamp(label: string) {
  if (!enabled) return
  console.log(`[bench] ${label}: +${performance.now().toFixed(1)}ms`)
}
