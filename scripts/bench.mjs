// Measures the double-click path end to end and checks it against the gate.
//
//   npm run bench                     50 warm opens, gate 120ms
//   npm run bench -- --n=100
//   npm run bench -- --gate=150
//   npm run bench -- --cold           one open with no host running
//
// Timing is taken by the host itself (src/main/bench.ts) and appended to
// %LOCALAPPDATA%\kunang\bench.jsonl. This script drives real stub launches --
// the same binary Explorer runs on a double-click -- rather than simulating
// them, so the numbers include process creation and the pipe handshake.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=')[1] : fallback
}

const iterations = Number(flag('n', '50'))
const gateMs = Number(flag('gate', '120'))
const coldOnly = args.includes('--cold')

const dataDir = join(process.env.LOCALAPPDATA || '', 'kunang')
const benchFile = join(dataDir, 'bench.jsonl')
const hostPointer = join(dataDir, 'host')
const stubExe = join(root, 'stub', 'kunangstub.exe')

function fail(msg) {
  process.stderr.write(`\nbench aborted: ${msg}\n`)
  process.exit(1)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// --- Preconditions ----------------------------------------------------------

if (!Number.isFinite(iterations) || iterations < 1) fail(`bad --n=${flag('n', '')}`)
if (!Number.isFinite(gateMs) || gateMs < 1) fail(`bad --gate=${flag('gate', '')}`)

if (!existsSync(stubExe)) {
  process.stdout.write('stub not built, running npm run build:stub\n')
  const r = spawnSync(process.execPath, [join(root, 'node_modules', 'npm', 'bin', 'npm-cli.js'), 'run', 'build:stub'], {
    cwd: root,
    stdio: 'inherit',
  })
  if (r.status !== 0 || !existsSync(stubExe)) fail('could not build stub/kunangstub.exe')
}

if (!existsSync(hostPointer)) {
  fail(
    'no host pointer at %LOCALAPPDATA%\\kunang\\host.\n' +
      '  Run dist/kunang-portable-<version>.exe once, or npm run package:portable first.',
  )
}

const hostExe = readFileSync(hostPointer, 'utf8').trim()
if (!existsSync(hostExe)) fail(`host pointer names a missing file: ${hostExe}`)

// A document that is representative rather than trivial: an empty file would
// measure process startup and nothing else.
const sampleFile = join(root, 'tests', 'corpus', 'emoji-rtl.md')
if (!existsSync(sampleFile)) fail(`missing sample document ${sampleFile}`)

// --- Host lifecycle ---------------------------------------------------------

/** Ask the resident host to exit, via the pipe. */
function stopHost() {
  spawnSync(stubExe, ['--quit'], { timeout: 5000 })
}

function startBenchHost() {
  const child = spawn(hostExe, ['--preload', '--bench'], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

async function waitForBenchHost(timeoutMs = 30000) {
  // The host truncates bench.jsonl on start, so its absence is not a signal.
  // Probe by opening a document and waiting for the first sample to land.
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    spawnSync(stubExe, [sampleFile], { timeout: 5000 })
    await sleep(400)
    if (readSamples().length > 0) return true
  }
  return false
}

function readSamples() {
  try {
    return readFileSync(benchFile, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l))
  } catch {
    return []
  }
}

// --- Statistics -------------------------------------------------------------

function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  // Nearest-rank: with 50 samples p95 is the 48th, an actual observation
  // rather than an interpolation between two.
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]
}

function summarize(values) {
  const s = [...values].sort((a, b) => a - b)
  const mean = s.reduce((a, b) => a + b, 0) / (s.length || 1)
  return {
    n: s.length,
    min: s[0] ?? 0,
    p50: percentile(s, 50),
    p95: percentile(s, 95),
    max: s[s.length - 1] ?? 0,
    mean,
  }
}

const fmt = (v) => v.toFixed(1).padStart(8)

function printTable(title, samples) {
  process.stdout.write(`\n${title}  (n=${samples.length})\n`)
  process.stdout.write(
    `  ${'hop'.padEnd(26)}${'min'.padStart(8)}${'p50'.padStart(8)}${'p95'.padStart(8)}${'max'.padStart(8)}\n`,
  )

  // Cumulative offsets from stub entry, then the deltas between them.
  const hops = [
    ['stub entry -> pipe read', (s) => s.pipe],
    ['  -> dispatched', (s) => s.dispatch],
    ['  -> renderer painted', (s) => s.paint],
    ['  -> window shown', (s) => s.show],
  ]

  for (const [label, pick] of hops) {
    const st = summarize(samples.map(pick))
    process.stdout.write(`  ${label.padEnd(26)}${fmt(st.min)}${fmt(st.p50)}${fmt(st.p95)}${fmt(st.max)}\n`)
  }

  const deltas = [
    ['pipe read', (s) => s.pipe],
    ['dispatch', (s) => s.dispatch - s.pipe],
    ['render + paint', (s) => s.paint - s.dispatch],
    ['show', (s) => s.show - s.paint],
  ]

  process.stdout.write(`\n  per-hop cost\n`)
  for (const [label, pick] of deltas) {
    const st = summarize(samples.map(pick))
    process.stdout.write(`  ${label.padEnd(26)}${fmt(st.min)}${fmt(st.p50)}${fmt(st.p95)}${fmt(st.max)}\n`)
  }
}

// --- Run --------------------------------------------------------------------

async function main() {
  mkdirSync(dataDir, { recursive: true })

  process.stdout.write(`host:  ${hostExe}\n`)
  process.stdout.write(`stub:  ${stubExe}\n`)
  process.stdout.write(`doc:   ${sampleFile}\n`)

  if (coldOnly) {
    process.stdout.write('\nCold path: stopping host, then opening a document.\n')
    stopHost()
    await sleep(2000)
    rmSync(benchFile, { force: true })

    // No host and no --bench, so the stub's self-heal spawns a plain host and
    // nothing is recorded. Start a bench host but do not warm it first.
    startBenchHost()
    const t0 = Date.now()
    if (!(await waitForBenchHost())) fail('host did not come up')
    process.stdout.write(`\nCold start to first served open: ${Date.now() - t0}ms (wall clock)\n`)

    const samples = readSamples()
    if (samples.length) printTable('First open after a cold host start', samples.slice(0, 1))
    stopHost()
    return
  }

  process.stdout.write(`\nRestarting host with --bench...\n`)
  stopHost()
  await sleep(1500)
  rmSync(benchFile, { force: true })
  startBenchHost()

  if (!(await waitForBenchHost())) {
    fail('host did not come up with --bench, or produced no samples')
  }

  // Everything recorded so far was the warm-up probe.
  rmSync(benchFile, { force: true })
  await sleep(500)

  process.stdout.write(`Running ${iterations} opens`)
  for (let i = 0; i < iterations; i++) {
    spawnSync(stubExe, [sampleFile], { timeout: 10000 })
    // Let the window paint, close, and the spare rebuild — otherwise this
    // measures the cold fallback rather than the warm path.
    await sleep(350)
    if ((i + 1) % 10 === 0) process.stdout.write(` ${i + 1}`)
  }
  process.stdout.write('\n')

  await sleep(1000)
  const samples = readSamples()
  stopHost()

  if (samples.length === 0) fail(`no samples recorded in ${benchFile}`)

  const warm = samples.filter((s) => !s.cold)
  const cold = samples.filter((s) => s.cold)

  printTable('Warm opens (spare available)', warm.length ? warm : samples)
  if (cold.length) printTable('Cold opens (spare had to be built)', cold)

  const target = warm.length ? warm : samples
  const p95 = summarize(target.map((s) => s.show)).p95

  writeFileSync(join(dataDir, 'bench-summary.json'), JSON.stringify({ gateMs, p95, samples: target.length }, null, 2))

  process.stdout.write(`\nGate: warm p95 <= ${gateMs}ms\n`)
  process.stdout.write(`Actual warm p95: ${p95.toFixed(1)}ms — ${p95 <= gateMs ? 'PASS' : 'FAIL'}\n`)

  if (cold.length) {
    process.stdout.write(
      `\nNote: ${cold.length}/${samples.length} opens found no warm spare and are excluded from the gate.\n`,
    )
  }

  process.exit(p95 <= gateMs ? 0 : 1)
}

main().catch((err) => fail(err?.message || String(err)))
