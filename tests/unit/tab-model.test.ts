import { describe, it, assert } from './test-runner'
import {
  createTab,
  findByPath,
  findById,
  closeAt,
  stepIndex,
  moveTab,
  slotToIndex,
} from '../../src/renderer/tab-model'

function tabs(...paths: (string | null)[]) {
  return paths.map((p, i) => createTab(i + 1, p))
}

describe('tab model', () => {
  it('finds a tab by path', () => {
    const t = tabs('a.md', 'b.md', 'c.md')
    assert.equal(findByPath(t, 'b.md'), 1)
    assert.equal(findByPath(t, 'missing.md'), -1)
  })

  it('does not match an untitled tab against a path', () => {
    const t = tabs('a.md', null)
    assert.equal(findByPath(t, 'b.md'), -1)
  })

  it('finds a tab by id after the indices have shifted', () => {
    const { tabs: t } = closeAt(tabs('a.md', 'b.md', 'c.md'), 0, 0)
    assert.equal(findById(t, 3), 1)
  })

  it('activates the tab to the right when the active one closes', () => {
    const r = closeAt(tabs('a.md', 'b.md', 'c.md'), 1, 1)
    assert.equal(r.activeIndex, 1)
    assert.equal(r.tabs[r.activeIndex].path, 'c.md')
  })

  it('activates the tab to the left when the last one closes', () => {
    const r = closeAt(tabs('a.md', 'b.md', 'c.md'), 2, 2)
    assert.equal(r.activeIndex, 1)
    assert.equal(r.tabs[r.activeIndex].path, 'b.md')
  })

  it('keeps the same document active when a tab to its left closes', () => {
    const r = closeAt(tabs('a.md', 'b.md', 'c.md'), 0, 2)
    assert.equal(r.activeIndex, 1)
    assert.equal(r.tabs[r.activeIndex].path, 'c.md')
  })

  it('keeps the same document active when a tab to its right closes', () => {
    const r = closeAt(tabs('a.md', 'b.md', 'c.md'), 2, 0)
    assert.equal(r.activeIndex, 0)
    assert.equal(r.tabs[r.activeIndex].path, 'a.md')
  })

  it('reports an empty list when the only tab closes', () => {
    const r = closeAt(tabs('a.md'), 0, 0)
    assert.equal(r.tabs.length, 0)
    assert.equal(r.activeIndex, -1)
  })

  it('ignores an out-of-range close', () => {
    const t = tabs('a.md', 'b.md')
    const r = closeAt(t, 5, 1)
    assert.equal(r.tabs.length, 2)
    assert.equal(r.activeIndex, 1)
  })

  it('wraps forward past the last tab', () => {
    assert.equal(stepIndex(3, 2, 1), 0)
  })

  it('wraps backward past the first tab', () => {
    assert.equal(stepIndex(3, 0, -1), 2)
  })

  it('steps within the list', () => {
    assert.equal(stepIndex(3, 0, 1), 1)
    assert.equal(stepIndex(3, 2, -1), 1)
  })

  it('reports no position for an empty list', () => {
    assert.equal(stepIndex(0, -1, 1), -1)
  })
})

const order = (t: ReturnType<typeof tabs>) => t.map((x) => x.path).join(' ')

describe('tab reordering', () => {
  it('moves a tab to the right', () => {
    const r = moveTab(tabs('a.md', 'b.md', 'c.md'), 0, 2, 0)
    assert.equal(order(r.tabs), 'b.md c.md a.md')
  })

  it('moves a tab to the left', () => {
    const r = moveTab(tabs('a.md', 'b.md', 'c.md'), 2, 0, 2)
    assert.equal(order(r.tabs), 'c.md a.md b.md')
  })

  it('keeps the dragged tab active when it is the one that moved', () => {
    const r = moveTab(tabs('a.md', 'b.md', 'c.md'), 0, 2, 0)
    assert.equal(r.activeIndex, 2)
    assert.equal(r.tabs[r.activeIndex].path, 'a.md')
  })

  it('follows the active document when another tab moves past it', () => {
    // b is active; a is dragged to the end, so b shifts down one.
    const r = moveTab(tabs('a.md', 'b.md', 'c.md'), 0, 2, 1)
    assert.equal(r.activeIndex, 0)
    assert.equal(r.tabs[r.activeIndex].path, 'b.md')
  })

  it('follows the active document when a tab moves back past it', () => {
    // b is active; c is dragged to the front, so b shifts up one.
    const r = moveTab(tabs('a.md', 'b.md', 'c.md'), 2, 0, 1)
    assert.equal(r.activeIndex, 2)
    assert.equal(r.tabs[r.activeIndex].path, 'b.md')
  })

  it('leaves the active document alone when the move is entirely to its left', () => {
    const r = moveTab(tabs('a.md', 'b.md', 'c.md', 'd.md'), 0, 1, 3)
    assert.equal(r.activeIndex, 3)
    assert.equal(r.tabs[r.activeIndex].path, 'd.md')
  })

  it('returns the same array when a tab is dropped where it already is', () => {
    // The caller uses identity to skip a repaint and a session write.
    const t = tabs('a.md', 'b.md')
    assert.equal(moveTab(t, 1, 1, 0).tabs, t)
  })

  it('clamps a destination past the end', () => {
    const r = moveTab(tabs('a.md', 'b.md', 'c.md'), 0, 99, 0)
    assert.equal(order(r.tabs), 'b.md c.md a.md')
  })

  it('ignores an out-of-range source', () => {
    const t = tabs('a.md', 'b.md')
    const r = moveTab(t, 7, 0, 1)
    assert.equal(r.tabs, t)
    assert.equal(r.activeIndex, 1)
  })

  it('survives a move with no active tab', () => {
    const r = moveTab(tabs('a.md', 'b.md'), 0, 1, -1)
    assert.equal(order(r.tabs), 'b.md a.md')
    assert.equal(r.activeIndex, -1)
  })

  it('reads a drop gap left of the dragged tab as that position', () => {
    // Dropping tab 3 into the gap before tab 1 puts it at index 1.
    assert.equal(slotToIndex(1, 3), 1)
  })

  it('discounts the dragged tab itself for a drop gap to its right', () => {
    // Tab 0 dropped into the gap past the last of four tabs is index 3, not 4:
    // it is lifted out of the list before it goes back in.
    assert.equal(slotToIndex(4, 0), 3)
  })

  it('reads the two gaps either side of the dragged tab as no move', () => {
    assert.equal(slotToIndex(2, 2), 2)
    assert.equal(slotToIndex(3, 2), 2)
  })
})
