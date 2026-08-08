import morphdom from 'morphdom'
import { renderMarkdown } from './render'

const previewContent = document.getElementById('preview-content')!
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let lastRendered = ''

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
          return true
        },
      })
    }

    lastRendered = html
  }, 80)
}
