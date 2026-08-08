import { performance } from 'perf_hooks'

const timeOrigin = performance.timeOrigin

let epochOffset = 0

export function setEpochOffset(t0UnixNano: number) {
  epochOffset = timeOrigin - t0UnixNano / 1_000_000
}

export function benchStamp(label: string, t0UnixNano?: number) {
  const now = performance.now()

  if (t0UnixNano !== undefined) {
    setEpochOffset(t0UnixNano)
  }

  const elapsed = now // ms from timeOrigin

  if (t0UnixNano !== undefined) {
    const stubEntry = (t0UnixNano / 1_000_000) - timeOrigin + now
    console.log(`[bench] ${label}: +${elapsed.toFixed(1)}ms (stub entry +${Math.abs(stubEntry).toFixed(1)}ms)`)
  } else {
    console.log(`[bench] ${label}: +${elapsed.toFixed(1)}ms`)
  }
}
