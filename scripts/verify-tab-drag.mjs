// Verifies tab drag-to-reorder and dragging a tab out into its own window.
//
//   npm run build
//   node scripts/verify-tab-drag.mjs
//
// The model behind reordering is unit-tested (tests/unit/tab-model.test.ts).
// What that cannot reach is the wiring: which listener wins when a drop lands
// on the strip, whether the strip repaints in the new order, and whether a
// tear-out really produces a second window with the document in it. All three
// only exist in a running app, so this drives one.
//
// Drags are synthesized in the page over the real DOM rather than through the
// OS, because the native drag loop is modal and would block the very automation
// that started it. That covers everything except Chromium's own decision to
// begin a drag on a `draggable` element, which is not ours to test.
//
// The host under test is a dev run of out/, not the installed kunang. The two
// files it would otherwise disturb -- the host pointer and the saved session --
// are restored on the way out.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = join(process.env.LOCALAPPDATA || '', 'kunang')
const stub = join(root, 'stub', 'kunangstub.exe')
const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = 9333

const docs = ['crlf.md', 'xss.md', 'emoji-rtl.md'].map((n) => join(root, 'tests', 'corpus', n))

let failures = 0

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function check(label, expected, actual) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual)
  if (ok) {
    console.log(`  PASS  ${label}`)
  } else {
    console.log(`  FAIL  ${label}`)
    console.log(`          expected ${JSON.stringify(expected)}`)
    console.log(`          actual   ${JSON.stringify(actual)}`)
    failures++
  }
}

// --- Preconditions ---------------------------------------------------------

for (const p of [stub, electron, join(root, 'out', 'main', 'index.js'), ...docs]) {
  if (!existsSync(p)) throw new Error(`missing ${p} (run npm run build / npm run build:stub)`)
}

// --- Host lifecycle --------------------------------------------------------

function stopInstalledHost() {
  spawnSync(stub, ['--quit'], { timeout: 10000 })
  // The stub spawns the installed host whenever it cannot reach one, so a
  // --quit against a host that is already gone briefly starts a new one.
  spawnSync('powershell', [
    '-NoProfile',
    '-Command',
    'Start-Sleep -Seconds 4; Get-Process -Name kunang -ErrorAction SilentlyContinue | Stop-Process -Force',
  ])
}

function stopDevHost() {
  // By path, so this can never reach an unrelated Electron app.
  spawnSync('powershell', [
    '-NoProfile',
    '-Command',
    `Get-Process -Name electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '${electron}' } | Stop-Process -Force`,
  ])
}

// --- CDP -------------------------------------------------------------------

async function targets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`)
  return (await res.json()).filter((t) => t.type === 'page')
}

/** The page showing `title`. Windows are told apart by it because the renderer
 *  already puts the active tab's file name there. */
async function pageFor(title, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const hit = (await targets()).find((t) => t.title === title)
    if (hit) return hit
    await sleep(250)
  }
  return null
}

/** Evaluate an expression in a page and return its value. */
async function evaluate(target, expression) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((ok, no) => {
    ws.onopen = ok
    ws.onerror = () => no(new Error('could not attach the debugger'))
  })

  const result = await new Promise((ok, no) => {
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id !== 1) return
      if (msg.error) return no(new Error(msg.error.message))
      if (msg.result?.exceptionDetails) {
        return no(new Error(msg.result.exceptionDetails.exception?.description || 'page threw'))
      }
      ok(msg.result.result.value)
    }
    ws.send(
      JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    )
  })

  ws.close()
  return result
}

// --- The page-side script --------------------------------------------------
// Everything below runs inside the renderer. Real DragEvents carrying a real
// DataTransfer, so the app's own listeners cannot tell them from a mouse.

const HELPERS = `
  const strip = document.getElementById('tab-strip')
  const tabEls = () => [...strip.querySelectorAll('.tab')]
  const order = () => tabEls().map((el) => el.querySelector('.tab-label').textContent)

  const fire = (el, type, x, dt) =>
    el.dispatchEvent(new DragEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      clientX: x, clientY: el.getBoundingClientRect().top + 8,
      dataTransfer: dt,
    }))

  // The x of a gap: 0 is the left edge of the first tab, n the right edge of
  // the last. Aimed a few pixels inside so it cannot land on a neighbour.
  const gapX = (slot) => {
    const els = tabEls()
    if (slot >= els.length) return els[els.length - 1].getBoundingClientRect().right - 4
    return els[slot].getBoundingClientRect().left + 4
  }

  const settle = () => new Promise((r) => setTimeout(r, 400))
`

/** Drag the tab at `from` into gap `slot`, and report the resulting order. */
function reorderScript(from, slot) {
  return `(async () => {
    ${HELPERS}
    const dt = new DataTransfer()
    const el = tabEls()[${from}]
    const x = gapX(${slot})

    fire(el, 'dragstart', el.getBoundingClientRect().left + 8, dt)
    fire(strip, 'dragover', x, dt)
    const marked = tabEls().some((t) => t.classList.contains('drop-before') || t.classList.contains('drop-after'))
    fire(strip, 'drop', x, dt)
    fire(el, 'dragend', x, dt)

    await settle()
    return JSON.stringify({ order: order(), marked })
  })()`
}

/** The keyboard route to the same reorder: Ctrl+Shift+PageDown / PageUp. */
function shiftScript(key) {
  return `(async () => {
    ${HELPERS}
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: '${key}', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
    }))

    await settle()
    return JSON.stringify({ order: order(), active: strip.querySelector('.tab.active .tab-label').textContent })
  })()`
}

/** Drag the tab at `from` out of the strip and drop it on the document pane. */
function detachScript(from) {
  return `(async () => {
    ${HELPERS}
    const dt = new DataTransfer()
    const el = tabEls()[${from}]
    const pane = document.getElementById('view-mode')

    fire(el, 'dragstart', el.getBoundingClientRect().left + 8, dt)
    pane.dispatchEvent(new DragEvent('drop', {
      bubbles: true, cancelable: true, composed: true,
      clientX: 300, clientY: 300, dataTransfer: dt,
    }))
    fire(el, 'dragend', 300, dt)

    await settle()
    return JSON.stringify({ order: order() })
  })()`
}

/** Cancel a drag the way Esc does: `dragend` with nothing having been dropped
 *  and no usable position. Chromium reports 0,0 here, which must not read as a
 *  release outside the window. */
function cancelScript(from) {
  return `(async () => {
    ${HELPERS}
    const dt = new DataTransfer()
    const el = tabEls()[${from}]

    fire(el, 'dragstart', el.getBoundingClientRect().left + 8, dt)
    el.dispatchEvent(new DragEvent('dragend', {
      bubbles: true, cancelable: true, composed: true,
      clientX: 0, clientY: 0, dataTransfer: dt,
    }))

    await settle()
    return JSON.stringify({ order: order() })
  })()`
}

/**
 * Release the tab at `from` outside the window: no drop handler runs, and
 * `dragend` has only its own coordinates to go on.
 *
 * What this cannot cover is whether Chromium reports a real release outside
 * the window with coordinates that land outside the viewport. Everything after
 * that decision is what runs here.
 */
function dragOutScript(from) {
  return `(async () => {
    ${HELPERS}
    const dt = new DataTransfer()
    const el = tabEls()[${from}]

    fire(el, 'dragstart', el.getBoundingClientRect().left + 8, dt)
    el.dispatchEvent(new DragEvent('dragend', {
      bubbles: true, cancelable: true, composed: true,
      clientX: window.innerWidth + 80, clientY: 40, dataTransfer: dt,
    }))

    await settle()
    return JSON.stringify({ order: order() })
  })()`
}

// --- Run -------------------------------------------------------------------

// Buffers, not strings: these are restored byte for byte, and a host pointer
// that gains so much as a BOM names a path that does not exist -- which leaves
// the installed kunang unable to start at all.
const backup = new Map()
for (const f of [join(dataDir, 'host'), join(dataDir, 'state.json')]) {
  if (existsSync(f)) backup.set(f, readFileSync(f))
}

// The host writes its own path here on startup, so a dev host that was run
// outside this script has already overwritten it. Restoring that value would
// preserve the damage rather than undo it.
const pointer = join(dataDir, 'host')
if (existsSync(pointer) && readFileSync(pointer, 'utf8').trim() === electron) {
  console.log(`WARNING: ${pointer} already names the dev host.`)
  console.log('         Run the portable exe once afterwards to point it back at the installed host.\n')
}

let child = null

try {
  console.log(`host:  ${electron}`)
  console.log(`docs:  ${docs.map((d) => d.split('\\').pop()).join(', ')}\n`)

  console.log('Stopping any resident host...')
  stopInstalledHost()
  stopDevHost()

  console.log('Starting the host from out/...')
  child = spawn(electron, [root, '--preload', `--remote-debugging-port=${PORT}`], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  await sleep(6000)

  console.log('Opening three documents...\n')
  for (const doc of docs) {
    spawnSync(stub, [doc], { timeout: 10000 })
    await sleep(1200)
  }

  const page = await pageFor('emoji-rtl.md')
  if (!page) throw new Error('the host never served the documents into one window')

  const before = JSON.parse(await evaluate(page, `(() => { ${HELPERS} return JSON.stringify(order()) })()`))
  check('three documents open as three tabs in strip order', ['crlf.md', 'xss.md', 'emoji-rtl.md'], before)

  console.log('\nDrag to reorder')

  // First tab dragged to the far right: the gap past the last tab is slot 3,
  // and the tab itself is lifted out on the way, so it lands at index 2.
  const right = JSON.parse(await evaluate(page, reorderScript(0, 3)))
  check('an insertion marker is drawn while dragging', true, right.marked)
  check('dragging the first tab to the end reorders it', ['xss.md', 'emoji-rtl.md', 'crlf.md'], right.order)

  // And back: the last tab dropped in the gap before the first.
  const left = JSON.parse(await evaluate(page, reorderScript(2, 0)))
  check('dragging the last tab to the front reorders it', ['crlf.md', 'xss.md', 'emoji-rtl.md'], left.order)

  // A drop that does not move anything must still leave the strip alone,
  // rather than detaching the tab into a window of its own. This is the case
  // the capture-phase document drop handler used to swallow.
  const windowsBefore = (await targets()).length
  const same = JSON.parse(await evaluate(page, reorderScript(1, 1)))
  check('dropping a tab where it already is changes nothing', ['crlf.md', 'xss.md', 'emoji-rtl.md'], same.order)
  // Counted rather than looked up by title: a window is named after its
  // active tab, which says nothing about the other tabs it holds.
  check('...and does not tear the tab out', windowsBefore, (await targets()).length)

  const order = ['crlf.md', 'xss.md', 'emoji-rtl.md']
  const cancelled = JSON.parse(await evaluate(page, cancelScript(1)))
  check('a drag cancelled with Esc leaves the strip alone', order, cancelled.order)
  check('...and does not tear the tab out either', windowsBefore, (await targets()).length)

  console.log('\nCtrl+Shift+PageDown / PageUp')

  // emoji-rtl.md is the active tab and sits last, so a step forward wraps it
  // round to the front.
  const shifted = JSON.parse(await evaluate(page, shiftScript('PageDown')))
  check('Ctrl+Shift+PageDown moves the tab', ['emoji-rtl.md', 'crlf.md', 'xss.md'], shifted.order)
  check('...and the same document stays on screen', 'emoji-rtl.md', shifted.active)

  const unshifted = JSON.parse(await evaluate(page, shiftScript('PageUp')))
  check('Ctrl+Shift+PageUp moves it back', ['crlf.md', 'xss.md', 'emoji-rtl.md'], unshifted.order)

  console.log('\nDrag out into a new window')

  const detached = JSON.parse(await evaluate(page, detachScript(1)))
  check('the tab leaves the window it was dragged out of', ['crlf.md', 'emoji-rtl.md'], detached.order)

  const spawned = await pageFor('xss.md', 15000)
  check('the document arrives in a window of its own', true, spawned !== null)

  const windows = (await targets()).filter((t) => t.title === 'xss.md').length
  check('and is open in exactly one window', 1, windows)

  // Two tabs left. Released outside the window, the first should go the same
  // way, leaving a single document behind — at which point the strip hides
  // itself again and reports no tabs at all.
  const droppedOut = JSON.parse(await evaluate(page, dragOutScript(0)))
  check('a tab released outside the window also detaches', [], droppedOut.order)
  check('and that document gets a window too', true, (await pageFor('crlf.md')) !== null)
} finally {
  console.log('\nStopping the host...')
  stopDevHost()
  await sleep(1000)

  // After the host is down, so its flush-on-exit cannot land on top of the
  // restore.
  for (const [file, content] of backup) writeFileSync(file, content)
  console.log('Restored the host pointer and saved session.')
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`)
  process.exit(1)
}

console.log('\nAll checks passed.')
