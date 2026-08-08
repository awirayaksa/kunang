import { describe, it, assert } from './test-runner'
import { findMatchIndices, locateIndex, Bounds } from '../../src/renderer/find'

// Only the index arithmetic is covered here — the DOM Range construction it
// feeds needs a browser. This is the part that is easy to get subtly wrong.

/** Build segment bounds the way collectSegments does, from text-node lengths. */
function boundsOf(parts: string[]): Bounds[] {
  const out: Bounds[] = []
  let at = 0
  for (const p of parts) {
    out.push({ start: at, end: at + p.length })
    at += p.length
  }
  return out
}

describe('find: match indices', () => {
  it('finds every occurrence', () => {
    assert.deepEqual(findMatchIndices('a cat and a cataract', 'cat'), [2, 12])
  })

  it('is case insensitive', () => {
    assert.deepEqual(findMatchIndices('Cat CAT cat', 'cat'), [0, 4, 8])
  })

  it('does not report overlapping matches', () => {
    // "aa" in "aaaa" is two matches, not three.
    assert.deepEqual(findMatchIndices('aaaa', 'aa'), [0, 2])
  })

  it('returns nothing for an empty needle', () => {
    assert.deepEqual(findMatchIndices('anything', ''), [])
  })

  it('returns nothing when absent', () => {
    assert.deepEqual(findMatchIndices('hello world', 'zzz'), [])
  })

  it('handles a match at the very start and very end', () => {
    assert.deepEqual(findMatchIndices('abcabc', 'abc'), [0, 3])
  })
})

describe('find: index to segment mapping', () => {
  const bounds = boundsOf(['Hello ', 'brave ', 'world'])

  it('maps a start index inside the first segment', () => {
    assert.deepEqual(locateIndex(bounds, 0, false), { segment: 0, offset: 0 })
    assert.deepEqual(locateIndex(bounds, 3, false), { segment: 0, offset: 3 })
  })

  it('maps a start index inside a later segment', () => {
    assert.deepEqual(locateIndex(bounds, 6, false), { segment: 1, offset: 0 })
    assert.deepEqual(locateIndex(bounds, 12, false), { segment: 2, offset: 0 })
  })

  it('resolves an end index on a boundary to the preceding segment', () => {
    // Index 6 ends "Hello ". As an end it must stay in segment 0 at offset 6,
    // not jump to segment 1 offset 0, or the range covers nothing.
    assert.deepEqual(locateIndex(bounds, 6, true), { segment: 0, offset: 6 })
    assert.deepEqual(locateIndex(bounds, 12, true), { segment: 1, offset: 6 })
  })

  it('resolves an end index at the very end of the text', () => {
    assert.deepEqual(locateIndex(bounds, 17, true), { segment: 2, offset: 5 })
  })

  it('returns null past the end', () => {
    assert.equal(locateIndex(bounds, 18, true), null)
    assert.equal(locateIndex(bounds, 17, false), null)
  })

  it('spans a match that crosses a segment boundary', () => {
    // "o b" spans the end of "Hello " and the start of "brave ".
    const at = findMatchIndices('Hello brave world', 'o b')[0]
    const start = locateIndex(bounds, at, false)
    const end = locateIndex(bounds, at + 3, true)
    assert.deepEqual(start, { segment: 0, offset: 4 })
    assert.deepEqual(end, { segment: 1, offset: 1 })
  })

  it('ignores empty segments without shifting offsets', () => {
    const withEmpty = boundsOf(['ab', '', 'cd'])
    assert.deepEqual(locateIndex(withEmpty, 2, false), { segment: 2, offset: 0 })
    assert.deepEqual(locateIndex(withEmpty, 2, true), { segment: 0, offset: 2 })
  })
})
