import { describe, it, assert } from './test-runner'
import { detectBom, detectEOL, toUtf8, sniffEncoding } from '../../src/main/encoding'

describe('encoding', () => {
  it('detects UTF-8 BOM', () => {
    const buf = Buffer.from([0xEF, 0xBB, 0xBF, 0x68, 0x65, 0x6C, 0x6C, 0x6F])
    const result = detectBom(buf)
    assert.equal(result.encoding, 'utf8')
    assert.equal(result.bom, true)
  })

  it('detects UTF-16LE BOM', () => {
    const buf = Buffer.from([0xFF, 0xFE, 0x68, 0x00, 0x65, 0x00])
    const result = detectBom(buf)
    assert.equal(result.encoding, 'utf16le')
    assert.equal(result.bom, true)
  })

  it('detects UTF-16BE BOM', () => {
    const buf = Buffer.from([0xFE, 0xFF, 0x00, 0x68, 0x00, 0x65])
    const result = detectBom(buf)
    assert.equal(result.encoding, 'utf16be')
    assert.equal(result.bom, true)
  })

  it('detects no BOM', () => {
    const buf = Buffer.from([0x68, 0x65, 0x6C, 0x6C, 0x6F])
    const result = detectBom(buf)
    assert.equal(result.encoding, 'utf8')
    assert.equal(result.bom, false)
  })

  it('detects CRLF as dominant EOL', () => {
    const result = detectEOL('hello\r\nworld\r\n')
    assert.equal(result, '\r\n')
  })

  it('detects LF as dominant EOL', () => {
    const result = detectEOL('hello\nworld\n')
    assert.equal(result, '\n')
  })

  it('detects CRLF when tied', () => {
    const result = detectEOL('hello\r\nworld\n')
    assert.equal(result, '\r\n')
  })

  it('converts UTF-16LE to UTF-8', () => {
    const buf = Buffer.from([0xFF, 0xFE, 0x68, 0x00, 0x65, 0x00])
    const result = toUtf8(buf, 'utf16le')
    assert.equal(result, 'he')
  })

  it('converts UTF-8 BOM to UTF-8', () => {
    const buf = Buffer.from([0xEF, 0xBB, 0xBF, 0x68, 0x65, 0x6C, 0x6C, 0x6F])
    const result = toUtf8(buf, 'utf8')
    assert.equal(result, 'hello')
  })

  it('sniffs encoding as UTF-8 for valid UTF-8', () => {
    const buf = Buffer.from('hello world', 'utf8')
    const result = sniffEncoding(buf)
    assert.equal(result, 'utf8')
  })
})
