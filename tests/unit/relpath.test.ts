import { describe, it, assert } from './test-runner'
import { toRelativePath, basename } from '../../src/renderer/relpath'

describe('relative paths for dropped files', () => {
  it('links a file in the same directory', () => {
    assert.equal(toRelativePath('C:\\docs', 'C:\\docs\\img.png'), './img.png')
  })

  it('links a file in a subdirectory', () => {
    assert.equal(toRelativePath('C:\\docs', 'C:\\docs\\assets\\img.png'), './assets/img.png')
  })

  it('climbs out to a sibling directory', () => {
    assert.equal(toRelativePath('C:\\docs\\notes', 'C:\\docs\\img.png'), '../img.png')
  })

  it('climbs more than one level', () => {
    assert.equal(toRelativePath('C:\\a\\b\\c', 'C:\\a\\img.png'), '../../img.png')
  })

  it('climbs and descends', () => {
    assert.equal(toRelativePath('C:\\a\\b', 'C:\\a\\c\\img.png'), '../c/img.png')
  })

  it('accepts mixed separators', () => {
    assert.equal(toRelativePath('C:/docs', 'C:\\docs\\assets\\img.png'), './assets/img.png')
  })

  it('compares drive letters and directories case insensitively', () => {
    assert.equal(toRelativePath('c:\\Docs', 'C:\\docs\\img.png'), './img.png')
  })

  it('gives up on a different drive', () => {
    // No relative form exists across drives; the absolute path is correct.
    assert.equal(toRelativePath('C:\\docs', 'D:\\pics\\img.png'), 'D:\\pics\\img.png')
  })

  it('gives up between a UNC share and a local path', () => {
    assert.equal(
      toRelativePath('C:\\docs', '\\\\server\\share\\img.png'),
      '\\\\server\\share\\img.png',
    )
    assert.equal(toRelativePath('\\\\server\\share', 'C:\\docs\\img.png'), 'C:\\docs\\img.png')
  })

  it('links within a single UNC share', () => {
    assert.equal(
      toRelativePath('\\\\server\\share\\docs', '\\\\server\\share\\docs\\img.png'),
      './img.png',
    )
  })

  it('refuses to climb above a UNC share root', () => {
    // '..' cannot walk out of a server or share name.
    const target = '\\\\server\\other\\img.png'
    assert.equal(toRelativePath('\\\\server\\share\\docs', target), target)
  })

  it('returns the target unchanged when inputs are empty', () => {
    assert.equal(toRelativePath('', 'C:\\docs\\img.png'), 'C:\\docs\\img.png')
    assert.equal(toRelativePath('C:\\docs', ''), '')
  })

  it('extracts a basename from either separator', () => {
    assert.equal(basename('C:\\docs\\img.png'), 'img.png')
    assert.equal(basename('C:/docs/img.png'), 'img.png')
    assert.equal(basename('img.png'), 'img.png')
  })
})
