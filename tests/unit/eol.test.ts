import { describe, it, assert } from './test-runner'
import { detectEOL } from '../../src/main/encoding'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

function normalizeEOL(content: string, eol: string): string {
  return content.replace(/\r?\n/g, eol)
}

describe('EOL handling', () => {
  it('normalizes LF to CRLF', () => {
    const input = 'line1\nline2\nline3'
    const result = normalizeEOL(input, '\r\n')
    assert.equal(result, 'line1\r\nline2\r\nline3')
  })

  it('normalizes CRLF to LF', () => {
    const input = 'line1\r\nline2\r\nline3'
    const result = normalizeEOL(input, '\n')
    assert.equal(result, 'line1\nline2\nline3')
  })

  it('normalizes mixed endings to LF', () => {
    const input = 'line1\r\nline2\nline3\r\n'
    const result = normalizeEOL(input, '\n')
    assert.equal(result, 'line1\nline2\nline3\n')
  })

  it('handles empty string', () => {
    assert.equal(normalizeEOL('', '\r\n'), '')
    assert.equal(normalizeEOL('', '\n'), '')
  })

  it('handles single line with no EOL', () => {
    assert.equal(normalizeEOL('single line', '\r\n'), 'single line')
  })

  it('detects CRLF dominance', () => {
    const result = detectEOL('a\r\nb\r\nc\n')
    assert.equal(result, '\r\n')
  })

  it('detects LF dominance', () => {
    const result = detectEOL('a\nb\nc\r\n')
    assert.equal(result, '\n')
  })

  it('defaults to CRLF when no EOL found', () => {
    const result = detectEOL('no line endings here')
    assert.equal(result, '\r\n')
  })
})
