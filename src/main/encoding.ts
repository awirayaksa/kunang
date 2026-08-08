import iconv from 'iconv-lite'

export interface EncodingInfo {
  encoding: string
  bom: boolean
}

export function detectBom(buffer: Buffer): EncodingInfo {
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    return { encoding: 'utf8', bom: true }
  }
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
    return { encoding: 'utf16le', bom: true }
  }
  if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
    return { encoding: 'utf16be', bom: true }
  }
  return { encoding: 'utf8', bom: false }
}

export function sniffEncoding(buffer: Buffer): string {
  const info = detectBom(buffer)
  if (info.bom) return info.encoding

  // Try UTF-8 validation
  try {
    const str = buffer.toString('utf8')
    // If re-encoding produces same bytes, it's valid UTF-8
    if (Buffer.from(str, 'utf8').equals(buffer)) {
      return 'utf8'
    }
  } catch {
    // Not valid UTF-8
  }

  return 'cp1252'
}

export function toUtf8(buffer: Buffer, encoding: string): string {
  if (encoding === 'utf8') {
    // Strip BOM if present
    const info = detectBom(buffer)
    if (info.bom) {
      return buffer.subarray(3).toString('utf8')
    }
    return buffer.toString('utf8')
  }

  if (encoding === 'utf16le') {
    const info = detectBom(buffer)
    const start = info.bom ? 2 : 0
    return buffer.subarray(start).toString('utf16le')
  }

  if (encoding === 'utf16be') {
    const info = detectBom(buffer)
    const start = info.bom ? 2 : 0
    const sub = buffer.subarray(start)
    // Swap bytes for BE -> LE
    const le = Buffer.alloc(sub.length)
    for (let i = 0; i < sub.length; i += 2) {
      le[i] = sub[i + 1]
      le[i + 1] = sub[i]
    }
    return le.toString('utf16le')
  }

  // CP1252 fallback
  return iconv.decode(buffer, 'win1252')
}

export function detectEOL(content: string): string {
  let crlf = 0
  let lf = 0
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\r' && content[i + 1] === '\n') {
      crlf++
      i++
    } else if (content[i] === '\n') {
      lf++
    }
  }
  return crlf >= lf ? '\r\n' : '\n'
}
