export function extractOutline(html: string): { level: number; text: string; line: number }[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const headings = doc.querySelectorAll('h1[data-line], h2[data-line], h3[data-line], h4[data-line], h5[data-line], h6[data-line]')

  return Array.from(headings).map((h) => ({
    level: parseInt(h.tagName[1], 10),
    text: h.textContent || '',
    line: parseInt(h.getAttribute('data-line') || '0', 10),
  }))
}
