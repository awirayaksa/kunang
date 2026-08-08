import { readFileSync } from 'fs'
import { join } from 'path'
import MarkdownIt from 'markdown-it'
import katex from 'katex'
import { describe, it, assert } from './test-runner'
import { installMathRules } from '../../src/renderer/math-rules'

// KaTeX runs headless, so the formulas in the corpus fixture can be rendered
// for real here. This covers the half that matters: that the sources the
// parser extracts are ones KaTeX accepts. The DOM wiring in lazy-render.ts
// needs a browser and is not covered.

const md = new MarkdownIt()
installMathRules(md)

/** Pull the math sources back out of a rendered document. */
function extractMath(markdown: string): { inline: string[]; block: string[] } {
  const html = md.render(markdown)
  const inline: string[] = []
  const block: string[] = []

  const unescape = (s: string) =>
    s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')

  for (const m of html.matchAll(/<span class="math-inline">([\s\S]*?)<\/span>/g)) {
    inline.push(unescape(m[1]))
  }
  for (const m of html.matchAll(/<div class="math-block"[^>]*>([\s\S]*?)<\/div>/g)) {
    block.push(unescape(m[1]))
  }

  return { inline, block }
}

const fixture = readFileSync(join(__dirname, '..', 'corpus', 'katex.md'), 'utf8')

describe('KaTeX rendering of the corpus fixture', () => {
  const { inline, block } = extractMath(fixture)

  it('finds the inline formulas', () => {
    assert.equal(inline.length, 2)
    assert.equal(inline[0], 'E = mc^2')
  })

  it('finds the display formulas', () => {
    assert.equal(block.length, 3)
  })

  it('renders every inline formula without error', () => {
    for (const src of inline) {
      const html = katex.renderToString(src, { displayMode: false, throwOnError: true })
      assert.ok(html.includes('katex'))
    }
  })

  it('renders every display formula without error', () => {
    for (const src of block) {
      const html = katex.renderToString(src, { displayMode: true, throwOnError: true })
      assert.ok(html.includes('katex'))
    }
  })

  it('renders the integral, matrix and derivative specifically', () => {
    // These are the constructs most likely to be broken by a parsing bug that
    // trims or mangles the source — multi-line environments especially.
    const joined = block.join('\n')
    assert.ok(joined.includes('\\int_'))
    assert.ok(joined.includes('\\begin{bmatrix}'))
    assert.ok(joined.includes('\\frac'))

    const matrix = block.find((b) => b.includes('bmatrix'))!
    const html = katex.renderToString(matrix, { displayMode: true, throwOnError: true })
    assert.ok(html.includes('katex'))
  })

  it('does not throw on malformed input when throwOnError is off', () => {
    // This is how lazy-render.ts calls it: one bad formula must not take the
    // document down.
    const html = katex.renderToString('\\frac{', { throwOnError: false })
    assert.ok(html.length > 0)
  })
})
