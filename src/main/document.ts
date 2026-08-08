import { promises as fs } from 'fs'
import { dirname, basename, join } from 'path'
import * as cp from 'child_process'
import { app } from 'electron'
import { sniffEncoding, detectBom, detectEOL, toUtf8 } from './encoding'
import { getStubPath } from './paths'

export interface DocumentState {
  path: string
  content: string
  dirty: boolean
  encoding: string
  bom: boolean
  eol: string
}

const openDocuments = new Map<string, DocumentState>()

export async function openDocument(filePath: string): Promise<DocumentState> {
  const existing = openDocuments.get(filePath)
  if (existing) return { ...existing }

  const buffer = await fs.readFile(filePath)
  const { encoding, bom } = detectBom(buffer)
  const content = toUtf8(buffer, encoding)
  const eol = detectEOL(content)

  const doc: DocumentState = {
    path: filePath,
    content,
    dirty: false,
    encoding,
    bom,
    eol,
  }

  openDocuments.set(filePath, doc)
  return { ...doc }
}

export function updateContent(filePath: string, content: string) {
  const doc = openDocuments.get(filePath)
  if (doc) {
    doc.content = content
    doc.dirty = true
  }
}

export async function saveDocument(filePath: string, content: string): Promise<void> {
  const doc = openDocuments.get(filePath) || {
    path: filePath,
    content: '',
    dirty: false,
    encoding: 'utf8',
    bom: false,
    eol: '\r\n',
  }

  const output = normalizeEOL(content, doc.eol)
  const buf = toEncoding(output, doc.encoding, doc.bom)

  const dir = dirname(filePath)
  const base = basename(filePath)
  const tmpPath = join(dir, `.${base}.kunang-tmp`)

  await fs.writeFile(tmpPath, buf)

  try {
    // Try atomic replace via stub helper
    const stubPath = getStubPath()
    cp.execFileSync(stubPath, ['--replace', tmpPath, filePath], { timeout: 5000 })
  } catch {
    // Fallback to rename
    await fs.rename(tmpPath, filePath)
  }

  doc.dirty = false
  doc.content = content
  openDocuments.set(filePath, doc)
}

export function closeDocument(filePath: string) {
  openDocuments.delete(filePath)
}

function normalizeEOL(content: string, eol: string): string {
  return content.replace(/\r?\n/g, eol)
}

function toEncoding(content: string, encoding: string, bom: boolean): Buffer {
  if (encoding === 'utf16le') {
    const buf = Buffer.from(content, 'utf16le')
    if (bom) {
      const out = Buffer.alloc(buf.length + 2)
      out.writeUInt16LE(0xFEFF, 0)
      buf.copy(out, 2)
      return out
    }
    return buf
  }

  if (encoding === 'utf16be') {
    const buf = Buffer.from(content, 'utf16le')
    // Swap bytes for BE
    for (let i = 0; i < buf.length; i += 2) {
      const tmp = buf[i]
      buf[i] = buf[i + 1]
      buf[i + 1] = tmp
    }
    if (bom) {
      const out = Buffer.alloc(buf.length + 2)
      out.writeUInt16BE(0xFEFF, 0)
      buf.copy(out, 2)
      return out
    }
    return buf
  }

  // UTF-8 or CP1252
  if (bom) {
    const bomBuf = Buffer.from([0xEF, 0xBB, 0xBF])
    return Buffer.concat([bomBuf, Buffer.from(content, 'utf8')])
  }
  return Buffer.from(content, 'utf8')
}
