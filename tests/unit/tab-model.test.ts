import { describe, it, assert } from './test-runner'
import { createTab, findByPath, findById, closeAt, stepIndex } from '../../src/renderer/tab-model'

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
