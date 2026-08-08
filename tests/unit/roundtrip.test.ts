import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, assert } from './test-runner'
import { sniffEncoding, detectBom, toUtf8, fromUtf8, canEncode, detectEOL } from '../../src/main/encoding'

// Drives the real fixture bytes in tests/corpus, which scripts/gen-corpus.mjs
// produces. Reading them proves the detection path; re-encoding proves a save
// gives back the same file rather than quietly converting it to UTF-8.

const corpus = join(__dirname, '..', 'corpus')

function fixture(name: string): Buffer {
  return readFileSync(join(corpus, name))
}

/** Read a fixture the way openDocument does. */
function open(name: string) {
  const buffer = fixture(name)
  const { bom } = detectBom(buffer)
  const encoding = sniffEncoding(buffer)
  return { buffer, bom, encoding, content: toUtf8(buffer, encoding) }
}

describe('encoding round-trip (corpus fixtures)', () => {
  it('detects cp1252.md as cp1252, not utf8', () => {
    const doc = open('cp1252.md')
    assert.equal(doc.encoding, 'cp1252')
    assert.equal(doc.bom, false)
  })

  it('decodes cp1252 high bytes without replacement characters', () => {
    const doc = open('cp1252.md')
    // The whole point of the fixture: decoded as UTF-8 these bytes become
    // U+FFFD. Seeing even one means detection regressed.
    assert.equal(doc.content.includes('�'), false)
    assert.ok(doc.content.includes('“double”'))
    assert.ok(doc.content.includes('em — dash'))
    assert.ok(doc.content.includes('café'))
    assert.ok(doc.content.includes('€ 100'))
  })

  it('writes cp1252 back byte-for-byte', () => {
    const doc = open('cp1252.md')
    const out = fromUtf8(doc.content, doc.encoding, doc.bom)
    assert.ok(out.equals(doc.buffer))
  })

  it('detects utf16le.md by BOM and decodes surrogate pairs', () => {
    const doc = open('utf16le.md')
    assert.equal(doc.encoding, 'utf16le')
    assert.equal(doc.bom, true)
    assert.equal(doc.content.includes('�'), false)
    assert.ok(doc.content.includes('你好世界'))
    assert.ok(doc.content.includes('\u{1F680}'))
  })

  it('writes utf16le back byte-for-byte, BOM included', () => {
    const doc = open('utf16le.md')
    const out = fromUtf8(doc.content, doc.encoding, doc.bom)
    assert.ok(out.equals(doc.buffer))
  })

  it('detects utf16be.md by BOM and decodes surrogate pairs', () => {
    const doc = open('utf16be.md')
    assert.equal(doc.encoding, 'utf16be')
    assert.equal(doc.bom, true)
    assert.equal(doc.content.includes('�'), false)
    assert.ok(doc.content.includes('你好世界'))
    assert.ok(doc.content.includes('\u{1F680}'))
  })

  it('writes utf16be back byte-for-byte, BOM included', () => {
    const doc = open('utf16be.md')
    const out = fromUtf8(doc.content, doc.encoding, doc.bom)
    assert.ok(out.equals(doc.buffer))
  })

  it('decodes utf16le and utf16be to identical text', () => {
    assert.equal(open('utf16le.md').content, open('utf16be.md').content)
  })

  it('preserves CRLF in the crlf.md fixture', () => {
    const doc = open('crlf.md')
    assert.equal(detectEOL(doc.content), '\r\n')
  })

  it('reports cp1252 cannot hold characters outside its range', () => {
    // The realistic case: a CP1252 document edited to add an emoji.
    assert.equal(canEncode('plain ascii', 'cp1252'), true)
    assert.equal(canEncode('café — naïve', 'cp1252'), true)
    assert.equal(canEncode('emoji \u{1F600}', 'cp1252'), false)
    assert.equal(canEncode('CJK 你好', 'cp1252'), false)
  })

  it('treats the unicode encodings as able to hold anything', () => {
    assert.equal(canEncode('emoji \u{1F600} CJK 你好', 'utf8'), true)
    assert.equal(canEncode('emoji \u{1F600} CJK 你好', 'utf16le'), true)
    assert.equal(canEncode('emoji \u{1F600} CJK 你好', 'utf16be'), true)
  })

  it('round-trips utf8 with and without a BOM', () => {
    const text = 'plain café 你好 \u{1F600}\n'
    assert.equal(toUtf8(fromUtf8(text, 'utf8', false), 'utf8'), text)
    const withBom = fromUtf8(text, 'utf8', true)
    assert.equal(withBom[0], 0xEF)
    assert.equal(toUtf8(withBom, 'utf8'), text)
  })
})
