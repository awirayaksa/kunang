import { renderMarkdown } from './render'

export function exportHTML(markdown: string, title: string): string {
  const body = renderMarkdown(markdown)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
  body {
    max-width: 72ch;
    margin: 0 auto;
    padding: 2rem 1rem;
    font-family: 'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, sans-serif;
    font-size: 16px;
    line-height: 1.7;
    color: #1e1e1e;
    background: #ffffff;
  }
  @media (prefers-color-scheme: dark) {
    body { color: #d4d4d4; background: #1e1e1e; }
  }
  pre { background: #f5f5f5; padding: 1rem; border-radius: 6px; overflow-x: auto; }
  @media (prefers-color-scheme: dark) {
    pre { background: #2d2d2d; }
  }
  code { font-family: 'Cascadia Mono', 'Consolas', 'Courier New', monospace; font-size: 14px; }
  img { max-width: 100%; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
  blockquote { border-left: 4px solid #ddd; margin: 0; padding-left: 1rem; color: #666; }
</style>
</head>
<body>
${body}
</body>
</html>`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
