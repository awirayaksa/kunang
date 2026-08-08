import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import DOMPurify from 'dompurify'
import { ALLOWED_TAGS, ALLOWED_ATTR, ALLOWED_URI_REGEXP } from './sanitize-config'

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: true,
  highlight: (str: string, lang: string): string => {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre><code class="hljs language-${lang}">${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`
      } catch {}
    }
    return `<pre><code class="hljs">${md.utils.escapeHtml(str)}</code></pre>`
  },
})

// Custom rule: stamp data-line on every top-level block for scroll sync
md.renderer.rules.paragraph_open = (tokens, idx) => {
  const line = tokens[idx].map?.[0] ?? 0
  return `<p data-line="${line}">`
}

md.renderer.rules.heading_open = (tokens, idx) => {
  const line = tokens[idx].map?.[0] ?? 0
  const tag = tokens[idx].tag
  return `<${tag} data-line="${line}">`
}

md.renderer.rules.blockquote_open = (tokens, idx) => {
  const line = tokens[idx].map?.[0] ?? 0
  return `<blockquote data-line="${line}">`
}

md.renderer.rules.bullet_list_open = (tokens, idx) => {
  const line = tokens[idx].map?.[0] ?? 0
  return `<ul data-line="${line}">`
}

md.renderer.rules.ordered_list_open = (tokens, idx) => {
  const line = tokens[idx].map?.[0] ?? 0
  return `<ol data-line="${line}">`
}

md.renderer.rules.table_open = (tokens, idx) => {
  const line = tokens[idx].map?.[0] ?? 0
  return `<table data-line="${line}">`
}

md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx]
  const line = token.map?.[0] ?? 0
  const info = token.info ? token.info.trim() : ''
  const lang = info.split(/\s+/g)[0]

  if (lang && hljs.getLanguage(lang)) {
    try {
      const highlighted = hljs.highlight(token.content, { language: lang, ignoreIllegals: true }).value
      return `<pre data-line="${line}"><code class="hljs language-${lang}">${highlighted}</code></pre>`
    } catch {}
  }

  return `<pre data-line="${line}"><code class="hljs">${md.utils.escapeHtml(token.content)}</code></pre>`
}

function resolveRelativePath(href: string, docPath: string): string {
  if (!href || href.startsWith('http://') || href.startsWith('https://') || href.startsWith('data:') || href.startsWith('#')) {
    return href
  }

  // Absolute Windows paths (e.g. C:\foo\bar)
  if (/^[a-zA-Z]:[/\\]/.test(href)) {
    return 'mdfile:///' + href.replace(/\\/g, '/')
  }

  // Resolve relative to the document directory
  const docDir = docPath.replace(/[/\\][^/\\]*$/, '')
  const parts = docDir.replace(/\\/g, '/').split('/')
  const hrefParts = href.replace(/\\/g, '/').split('/')

  for (const part of hrefParts) {
    if (part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }

  return 'mdfile:///' + parts.join('/').replace(/^\//, '')
}

export function initRenderer(markdown: string, docPath: string): string {
  const html = md.render(markdown)

  // Rewrite relative paths to mdfile://
  const dom = new DOMParser().parseFromString(html, 'text/html')

  dom.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src') || ''
    if (!src.startsWith('http') && !src.startsWith('data:')) {
      img.setAttribute('src', resolveRelativePath(src, docPath))
    }
  })

  dom.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') || ''
    if (!href.startsWith('http') && !href.startsWith('data:') && !href.startsWith('#')) {
      a.setAttribute('href', resolveRelativePath(href, docPath))
    }
  })

  return DOMPurify.sanitize(dom.body.innerHTML, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: true,
    ALLOWED_URI_REGEXP,
  })
}

export function renderMarkdown(markdown: string): string {
  return DOMPurify.sanitize(md.render(markdown), {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: true,
    ALLOWED_URI_REGEXP,
  })
}
