import MarkdownIt from 'markdown-it'
import { describe, it, assert } from './test-runner'
import { installMathRules } from '../../src/renderer/math-rules'

// markdown-it is pure JS, so the rules can be exercised without a DOM. What
// matters is which dollar signs become math and, more importantly, which do
// not: false positives corrupt ordinary prose.

const md = new MarkdownIt({ html: false, linkify: true, typographer: true, breaks: true })
installMathRules(md)

const render = (src: string) => md.render(src)

describe('math parsing', () => {
  it('recognises inline math', () => {
    const html = render('Energy is $E = mc^2$ exactly.')
    assert.ok(html.includes('<span class="math-inline">E = mc^2</span>'))
  })

  it('recognises display math', () => {
    const html = render('$$\n\\int_0^1 x dx\n$$')
    assert.ok(html.includes('class="math-block"'))
    assert.ok(html.includes('\\int_0^1 x dx'))
  })

  it('recognises single-line display math', () => {
    const html = render('$$ x = 1 $$')
    assert.ok(html.includes('class="math-block"'))
    assert.ok(html.includes('x = 1'))
  })

  it('escapes markup inside math so it cannot inject tags', () => {
    const html = render('$a <script>alert(1)</script> b$')
    assert.equal(html.includes('<script>'), false)
    assert.ok(html.includes('&lt;script&gt;'))
  })

  it('leaves shell variables in a fenced code block alone', () => {
    const html = render('```sh\necho $PATH and $HOME\n```')
    assert.equal(html.includes('math-inline'), false)
    assert.ok(html.includes('$PATH'))
  })

  it('leaves a variable in inline code alone', () => {
    const html = render('Use `$HOME` for that.')
    assert.equal(html.includes('math-inline'), false)
  })

  it('does not treat prices as math', () => {
    // "$5 and $10" must stay prose; a closing dollar followed by a digit is
    // the giveaway.
    const html = render('It costs $5 and $10 today.')
    assert.equal(html.includes('math-inline'), false)
  })

  it('ignores an escaped dollar', () => {
    const html = render('Literal \\$x\\$ here.')
    assert.equal(html.includes('math-inline'), false)
  })

  it('ignores empty delimiters', () => {
    const html = render('Nothing $$ here inline.')
    assert.equal(html.includes('math-inline'), false)
  })

  it('does not let inline math span a line break', () => {
    const html = render('start $broken\nstill going$ end')
    assert.equal(html.includes('math-inline'), false)
  })

  it('leaves an unterminated display block as ordinary text', () => {
    // Swallowing the rest of the document would be far worse than not
    // rendering one formula.
    const html = render('$$\nx = 1\n\nplain paragraph after')
    assert.equal(html.includes('math-block'), false)
    assert.ok(html.includes('plain paragraph after'))
  })

  it('stamps a data-line on display math for scroll sync', () => {
    const html = render('# Title\n\n$$\nx\n$$')
    assert.ok(/class="math-block" data-line="\d+"/.test(html))
  })

  it('handles several inline formulas in one paragraph', () => {
    const html = render('$a$ then $b$ then $c$')
    assert.equal((html.match(/math-inline/g) || []).length, 3)
  })
})

describe('mermaid fences', () => {
  // The fence rule lives in render.ts, which pulls in DOMPurify and needs a
  // DOM, so this asserts the contract the lazy pass depends on: a mermaid
  // fence must reach it as source text, not as highlighted markup.
  it('is recognised as a distinct language', () => {
    const html = render('```mermaid\ngraph TD\n  A --> B\n```')
    assert.ok(html.includes('graph TD'))
  })
})
