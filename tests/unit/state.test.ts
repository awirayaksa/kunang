import { describe, it, assert } from './test-runner'
import { recordScroll } from '../../src/main/state'

describe('scroll position store', () => {
  it('records a position', () => {
    const p = recordScroll({}, 'a.md', 120)
    assert.equal(p['a.md'], 120)
  })

  it('overwrites the position for a path already present', () => {
    let p = recordScroll({}, 'a.md', 120)
    p = recordScroll(p, 'a.md', 340)
    assert.equal(p['a.md'], 340)
    assert.equal(Object.keys(p).length, 1)
  })

  it('evicts the least recently touched entry past the cap', () => {
    let p: Record<string, number> = {}
    for (const name of ['a', 'b', 'c']) {
      p = recordScroll(p, `${name}.md`, 1, 3)
    }
    p = recordScroll(p, 'd.md', 1, 3)

    assert.deepEqual(Object.keys(p), ['b.md', 'c.md', 'd.md'])
    assert.equal(p['a.md'], undefined)
  })

  it('treats re-recording as a touch that avoids eviction', () => {
    let p: Record<string, number> = {}
    for (const name of ['a', 'b', 'c']) {
      p = recordScroll(p, `${name}.md`, 1, 3)
    }
    // a.md is oldest; touching it should make b.md the eviction candidate.
    p = recordScroll(p, 'a.md', 999, 3)
    p = recordScroll(p, 'd.md', 1, 3)

    assert.deepEqual(Object.keys(p), ['c.md', 'a.md', 'd.md'])
    assert.equal(p['a.md'], 999)
    assert.equal(p['b.md'], undefined)
  })

  it('evicts down to the cap when the map starts oversized', () => {
    const p: Record<string, number> = {}
    for (let i = 0; i < 10; i++) p[`f${i}.md`] = i

    const out = recordScroll(p, 'new.md', 5, 3)
    assert.equal(Object.keys(out).length, 3)
    assert.deepEqual(Object.keys(out), ['f8.md', 'f9.md', 'new.md'])
  })
})
