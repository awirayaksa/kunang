// The DOMPurify allowlist, kept in a module with no DOM or library imports so
// that tests can assert against the values the renderer actually uses rather
// than against a copy that can drift out of sync.

export const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'em', 'strong',
  'del', 'ins', 'sup', 'sub', 'a', 'img', 'table', 'thead',
  'tbody', 'tr', 'th', 'td', 'details', 'summary', 'span', 'label',
  'div', 'input',
]

export const ALLOWED_ATTR = [
  'href', 'src', 'alt', 'title', 'class', 'id', 'data-line',
  'checked', 'disabled', 'type',
]

// Permits http, https and our own mdfile scheme, plus relative references.
// Anything else — javascript:, vbscript:, data: — is dropped.
export const ALLOWED_URI_REGEXP = /^(?:(?:https?|mdfile):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i
