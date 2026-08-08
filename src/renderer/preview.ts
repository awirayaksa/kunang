import morphdom from 'morphdom'
import { renderMarkdown } from './render'
import { enhance } from './lazy-render'

const previewContent = document.getElementById('preview-content')!
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let lastRendered = ''

function prefersDark(): boolean {
  const explicit = document.documentElement.dataset.theme
  if (explicit === 'dark') return true
  if (explicit === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function updatePreview(markdown: string) {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }

  debounceTimer = setTimeout(() => {
    const html = renderMarkdown(markdown)

    if (lastRendered === '') {
      previewContent.innerHTML = html
    } else {
      // Morph existing DOM to preserve scroll, details state, etc.
      const temp = document.createElement('div')
      temp.innerHTML = html
      morphdom(previewContent, temp, {
        onBeforeElUpdated: (fromEl, toEl) => {
          // Preserve open state of details elements
          if (fromEl.tagName === 'DETAILS' && fromEl.hasAttribute('open')) {
            toEl.setAttribute('open', '')
          }

          // An already-rendered diagram whose source has not changed must not
          // be reverted to its placeholder — re-rendering it on every
          // keystroke would flicker and is expensive.
          if (
            fromEl.classList?.contains('mermaid-rendered') &&
            toEl.classList?.contains('mermaid-block') &&
            fromEl.getAttribute('data-line') === toEl.getAttribute('data-line')
          ) {
            return false
          }

          return true
        },
      })
    }

    lastRendered = html
    void enhance(previewContent, prefersDark())
  }, 80)
}
