import { describe, it, assert } from './test-runner'

// Pure logic test for relative path resolution
// Mirrors the logic in render.ts without DOM dependencies

function resolvePath(docPath: string, href: string): string {
  if (!href || href.startsWith('http://') || href.startsWith('https://') || href.startsWith('data:') || href.startsWith('#')) {
    return href
  }

  // Absolute Windows paths (e.g. C:\foo\bar)
  if (/^[a-zA-Z]:[/\\]/.test(href)) {
    return 'mdfile:///' + href.replace(/\\/g, '/')
  }

  const docDir = docPath.replace(/[/\\][^/\\]*$/, '')
  const parts = docDir.replace(/\\/g, '/').split('/')
  const hrefParts = href.replace(/\\/g, '/').split('/')

  for (const part of hrefParts) {
    if (part === '.') continue
    if (part === '..') {
      if (parts.length > 0) parts.pop()
      continue
    }
    parts.push(part)
  }

  return 'mdfile:///' + parts.join('/').replace(/^\//, '')
}

describe('path resolution', () => {
  it('resolves relative path in same directory', () => {
    const result = resolvePath('C:\\docs\\readme.md', './img.png')
    assert.equal(result, 'mdfile:///C:/docs/img.png')
  })

  it('resolves parent-relative path', () => {
    const result = resolvePath('C:\\docs\\sub\\readme.md', '../assets/x.png')
    assert.equal(result, 'mdfile:///C:/docs/assets/x.png')
  })

  it('prevents escaping document directory', () => {
    const result = resolvePath('C:\\docs\\readme.md', '../../../../windows/system32/config')
    assert.equal(result, 'mdfile:///windows/system32/config')
  })

  it('returns HTTP URLs unchanged', () => {
    assert.equal(resolvePath('C:\\docs\\readme.md', 'https://example.com'), 'https://example.com')
  })

  it('returns data URIs unchanged', () => {
    assert.equal(resolvePath('C:\\docs\\readme.md', 'data:image/png;base64,abc'), 'data:image/png;base64,abc')
  })

  it('handles anchor-only hrefs', () => {
    assert.equal(resolvePath('C:\\docs\\readme.md', '#section'), '#section')
  })

  it('handles empty href', () => {
    assert.equal(resolvePath('C:\\docs\\readme.md', ''), '')
  })

  it('handles absolute Windows path', () => {
    const result = resolvePath('C:\\docs\\readme.md', 'C:\\other\\file.md')
    assert.equal(result, 'mdfile:///C:/other/file.md')
  })

  it('handles mixed separators', () => {
    const result = resolvePath('C:\\docs/sub\\readme.md', '../assets/icon.png')
    assert.equal(result, 'mdfile:///C:/docs/assets/icon.png')
  })
})
