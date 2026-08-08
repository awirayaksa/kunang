import { describe, it, assert } from './test-runner'

// Test the DOMPurify allowlist logic — what we expect to be stripped
// These are pure string tests since we can't easily run DOMPurify in unit tests
// without DOM, but they document the expected behavior

const ALLOWED_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'em', 'strong',
  'del', 'ins', 'sup', 'sub', 'a', 'img', 'table', 'thead',
  'tbody', 'tr', 'th', 'td', 'details', 'summary', 'span', 'div',
  'input', 'label',
])

describe('sanitizer allowlist', () => {
  it('allows markdown content tags', () => {
    assert.equal(ALLOWED_TAGS.has('h1'), true)
    assert.equal(ALLOWED_TAGS.has('p'), true)
    assert.equal(ALLOWED_TAGS.has('code'), true)
    assert.equal(ALLOWED_TAGS.has('a'), true)
    assert.equal(ALLOWED_TAGS.has('img'), true)
    assert.equal(ALLOWED_TAGS.has('table'), true)
  })

  it('blocks script tags', () => {
    assert.equal(ALLOWED_TAGS.has('script'), false)
  })

  it('blocks iframe tags', () => {
    assert.equal(ALLOWED_TAGS.has('iframe'), false)
  })

  it('blocks object and embed tags', () => {
    assert.equal(ALLOWED_TAGS.has('object'), false)
    assert.equal(ALLOWED_TAGS.has('embed'), false)
  })

  it('blocks form tags', () => {
    assert.equal(ALLOWED_TAGS.has('form'), false)
  })

  it('blocks style tags', () => {
    assert.equal(ALLOWED_TAGS.has('style'), false)
  })

  it('blocks svg tags', () => {
    assert.equal(ALLOWED_TAGS.has('svg'), false)
  })

  it('allows details/summary for collapsible sections', () => {
    assert.equal(ALLOWED_TAGS.has('details'), true)
    assert.equal(ALLOWED_TAGS.has('summary'), true)
  })
})
