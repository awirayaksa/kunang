import { describe, it, assert } from './test-runner'
import { ALLOWED_TAGS, ALLOWED_ATTR, ALLOWED_URI_REGEXP } from '../../src/renderer/sanitize-config'

// Asserts against the very arrays render.ts passes to DOMPurify. An earlier
// version of this file compared a hand-copied Set, so the real allowlist could
// have gained <script> without a single test failing.

const tags = new Set(ALLOWED_TAGS)
const attrs = new Set(ALLOWED_ATTR)

describe('sanitizer allowlist', () => {
  it('allows markdown content tags', () => {
    for (const tag of ['h1', 'p', 'code', 'a', 'img', 'table', 'pre', 'blockquote']) {
      assert.equal(tags.has(tag), true)
    }
  })

  it('allows details/summary for collapsible sections', () => {
    assert.equal(tags.has('details'), true)
    assert.equal(tags.has('summary'), true)
  })

  it('blocks tags that execute or embed', () => {
    for (const tag of ['script', 'iframe', 'object', 'embed', 'form', 'style', 'svg', 'math', 'base', 'link', 'meta']) {
      assert.equal(tags.has(tag), false)
    }
  })

  it('allows only the attributes the renderer needs', () => {
    for (const attr of ['href', 'src', 'alt', 'title', 'class', 'data-line']) {
      assert.equal(attrs.has(attr), true)
    }
  })

  it('blocks event handler and style attributes', () => {
    for (const attr of ['onclick', 'onerror', 'onload', 'style', 'srcset', 'formaction']) {
      assert.equal(attrs.has(attr), false)
    }
  })

  it('permits http, https and mdfile URLs', () => {
    assert.equal(ALLOWED_URI_REGEXP.test('https://example.com/x'), true)
    assert.equal(ALLOWED_URI_REGEXP.test('http://example.com/x'), true)
    assert.equal(ALLOWED_URI_REGEXP.test('mdfile:///C:/docs/img.png'), true)
  })

  it('permits relative and anchor references', () => {
    assert.equal(ALLOWED_URI_REGEXP.test('./img.png'), true)
    assert.equal(ALLOWED_URI_REGEXP.test('../up.png'), true)
    assert.equal(ALLOWED_URI_REGEXP.test('#heading'), true)
  })

  it('rejects script-bearing URL schemes', () => {
    assert.equal(ALLOWED_URI_REGEXP.test('javascript:alert(1)'), false)
    assert.equal(ALLOWED_URI_REGEXP.test('vbscript:msgbox(1)'), false)
    assert.equal(ALLOWED_URI_REGEXP.test('data:text/html;base64,PHNjcmlwdD4='), false)
  })
})
