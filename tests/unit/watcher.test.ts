import { mkdtempSync, rmSync, writeFileSync, unlinkSync, renameSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, it, assert } from './test-runner'
import {
  setWatchSink,
  trackFile,
  untrackFile,
  suppressNextReload,
  closeAllWatchers,
} from '../../src/main/watcher'

// These run against real chokidar and a real directory. Mocking the watcher
// would only prove the mock works — the whole point is that the unlink/add
// pairing behaves the way Windows actually reports a rename.

interface Event {
  channel: string
  payload: any
}

let events: Event[] = []

setWatchSink((channel, payload) => {
  events.push({ channel, payload: payload as any })
})

function reset() {
  events = []
}

/** Poll until predicate holds or the budget runs out. */
async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((r) => setTimeout(r, 25))
  }
  return predicate()
}

function firstOf(channel: string): Event | undefined {
  return events.find((e) => e.channel === channel)
}

describe('file watcher', () => {
  it('reports a change to a tracked file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kunang-watch-'))
    const file = join(dir, 'doc.md')
    writeFileSync(file, '# one\n', 'utf8')

    try {
      reset()
      trackFile(file)
      // chokidar needs a moment to finish its initial scan before edits count.
      await new Promise((r) => setTimeout(r, 300))

      writeFileSync(file, '# two\n', 'utf8')

      const got = await waitFor(() => firstOf('file-changed') !== undefined)
      assert.ok(got)
      assert.equal(firstOf('file-changed')!.payload.path, file)
    } finally {
      untrackFile(file)
      closeAllWatchers()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('ignores changes to files that are not tracked', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kunang-watch-'))
    const tracked = join(dir, 'doc.md')
    const other = join(dir, 'other.md')
    writeFileSync(tracked, '# one\n', 'utf8')
    writeFileSync(other, '# other\n', 'utf8')

    try {
      reset()
      trackFile(tracked)
      await new Promise((r) => setTimeout(r, 300))

      writeFileSync(other, '# changed\n', 'utf8')
      await new Promise((r) => setTimeout(r, 800))

      assert.equal(firstOf('file-changed'), undefined)
    } finally {
      untrackFile(tracked)
      closeAllWatchers()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('suppresses the change event from our own write', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kunang-watch-'))
    const file = join(dir, 'doc.md')
    writeFileSync(file, '# one\n', 'utf8')

    try {
      reset()
      trackFile(file)
      await new Promise((r) => setTimeout(r, 300))

      suppressNextReload(file, 2000)
      writeFileSync(file, '# saved by us\n', 'utf8')
      await new Promise((r) => setTimeout(r, 800))

      assert.equal(firstOf('file-changed'), undefined)
    } finally {
      untrackFile(file)
      closeAllWatchers()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports removal when a tracked file is deleted', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kunang-watch-'))
    const file = join(dir, 'doc.md')
    writeFileSync(file, '# one\n', 'utf8')

    try {
      reset()
      trackFile(file)
      await new Promise((r) => setTimeout(r, 300))

      unlinkSync(file)

      const got = await waitFor(() => firstOf('file-removed') !== undefined)
      assert.ok(got)
      assert.equal(firstOf('file-removed')!.payload.path, file)
      // A plain delete must not be mistaken for a rename.
      assert.equal(firstOf('file-renamed'), undefined)
    } finally {
      untrackFile(file)
      closeAllWatchers()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('follows a rename instead of reporting removal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kunang-watch-'))
    const from = join(dir, 'doc.md')
    const to = join(dir, 'renamed.md')
    writeFileSync(from, '# one\n', 'utf8')

    try {
      reset()
      trackFile(from)
      await new Promise((r) => setTimeout(r, 300))

      renameSync(from, to)

      const got = await waitFor(() => firstOf('file-renamed') !== undefined)
      assert.ok(got)
      assert.equal(firstOf('file-renamed')!.payload.from, from)
      assert.equal(firstOf('file-renamed')!.payload.to, to)
      // The unlink half of the pair must not also surface as a removal.
      assert.equal(firstOf('file-removed'), undefined)
    } finally {
      untrackFile(to)
      closeAllWatchers()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
