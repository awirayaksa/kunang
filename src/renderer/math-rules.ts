import type MarkdownIt from 'markdown-it'
import type { StateInline, StateBlock } from 'markdown-it'

// Recognises $...$ and $$...$$ at parse time and emits placeholder elements
// holding the source as text. KaTeX fills them in later, only if the document
// actually contains math.
//
// Doing this as markdown-it rules rather than a regex pass over the rendered
// HTML matters: the parser already knows what is inside a code fence, so a
// shell snippet containing $PATH is left alone.

const DOLLAR = 0x24
const BACKSLASH = 0x5c
const NEWLINE = 0x0a

function mathInline(state: StateInline, silent: boolean): boolean {
  const start = state.pos
  if (state.src.charCodeAt(start) !== DOLLAR) return false

  // \$ is an escaped dollar, not the start of math.
  if (start > 0 && state.src.charCodeAt(start - 1) === BACKSLASH) return false

  // $$ belongs to the block rule.
  if (state.src.charCodeAt(start + 1) === DOLLAR) return false

  let pos = start + 1
  while (pos < state.posMax) {
    const code = state.src.charCodeAt(pos)
    if (code === NEWLINE) return false // inline math never spans lines
    if (code === DOLLAR && state.src.charCodeAt(pos - 1) !== BACKSLASH) break
    pos++
  }

  if (pos >= state.posMax) return false
  if (pos === start + 1) return false // "$$" with nothing between

  // A closing dollar immediately followed by a digit is far more likely to be
  // a price range than the end of a formula.
  const after = state.src.charCodeAt(pos + 1)
  if (after >= 0x30 && after <= 0x39) return false

  if (!silent) {
    const token = state.push('math_inline', 'span', 0)
    token.content = state.src.slice(start + 1, pos)
    token.markup = '$'
  }

  state.pos = pos + 1
  return true
}

function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const start = state.bMarks[startLine] + state.tShift[startLine]
  const max = state.eMarks[startLine]

  if (start + 2 > max) return false
  if (state.src.slice(start, start + 2) !== '$$') return false

  const firstLineRest = state.src.slice(start + 2, max).trim()

  // Closing on the same line: $$ x = 1 $$
  if (firstLineRest.endsWith('$$') && firstLineRest.length > 2) {
    if (!silent) {
      const token = state.push('math_block', 'div', 0)
      token.content = firstLineRest.slice(0, -2).trim()
      token.map = [startLine, startLine + 1]
      token.markup = '$$'
    }
    state.line = startLine + 1
    return true
  }

  let line = startLine
  let found = false

  while (line < endLine) {
    line++
    if (line >= endLine) break

    const from = state.bMarks[line] + state.tShift[line]
    const to = state.eMarks[line]
    if (from < to && state.src.slice(from, to).trim() === '$$') {
      found = true
      break
    }
  }

  // Unterminated: leave it as ordinary text rather than swallowing the rest of
  // the document.
  if (!found) return false

  if (!silent) {
    const contentStart = state.bMarks[startLine] + state.tShift[startLine] + 2
    const contentEnd = state.bMarks[line]

    const token = state.push('math_block', 'div', 0)
    token.content = state.src.slice(contentStart, contentEnd).trim()
    token.map = [startLine, line + 1]
    token.markup = '$$'
  }

  state.line = line + 1
  return true
}

export function installMathRules(md: InstanceType<typeof MarkdownIt>) {
  md.inline.ruler.before('escape', 'math_inline', mathInline)
  md.block.ruler.before('fence', 'math_block', mathBlock, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  })

  md.renderer.rules.math_inline = (tokens, idx) =>
    `<span class="math-inline">${md.utils.escapeHtml(tokens[idx].content)}</span>`

  md.renderer.rules.math_block = (tokens, idx) => {
    const line = tokens[idx].map?.[0] ?? 0
    return `<div class="math-block" data-line="${line}">${md.utils.escapeHtml(tokens[idx].content)}</div>`
  }
}
