import { promises as fs } from 'fs'
import { dirname, basename, join } from 'path'
import * as cp from 'child_process'
import { app } from 'electron'
import { sniffEncoding, detectBom, detectEOL, toUtf8, fromUtf8, canEncode } from './encoding'
import { getStubPath } from './paths'
import { trackFile, untrackFile, suppressNextReload } from './watcher'

export interface DocumentState {
  path: string
  content: string
  dirty: boolean
  encoding: string
  bom: boolean
  eol: string
}

const openDocuments = new Map<string, DocumentState>()

export async function openDocument(filePath: string, force = false): Promise<DocumentState> {
  // force skips the cache â€” F5 and watcher-driven reloads must see disk, not
  // the copy we handed out last time.
  const existing = openDocuments.get(filePath)
  if (existing && !force) return { ...existing }

  // Watch before reading: a file replaced between the read and the watch
  // would otherwise leave the window showing content nothing will correct.
  trackFile(filePath)

  const buffer = await fs.readFile(filePath)

  // detectBom only reports what a byte order mark declares. A CP1252 file has
  // no mark, so trusting detectBom alone decoded it as UTF-8 and turned every
  // accented character into U+FFFD. sniffEncoding validates the bytes.
  const { bom } = detectBom(buffer)
  const encoding = sniffEncoding(buffer)
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

  // A CP1252 document that gained an em-dash or emoji while being edited can
  // no longer be written as CP1252 without replacing those characters with
  // '?'. Promote to UTF-8 instead: it changes the file's encoding, which is
  // visible and reversible, rather than silently destroying characters.
  const encoding = canEncode(output, doc.encoding) ? doc.encoding : 'utf8'
  const buf = fromUtf8(output, encoding, doc.bom)

  const dir = dirname(filePath)
  const base = basename(filePath)
  const tmpPath = join(dir, `.${base}.kunang-tmp`)

  // Our own write would otherwise bounce straight back as a change event and
  // prompt the user about a conflict with themselves.
  suppressNextReload(filePath)
  trackFile(filePath)

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
  doc.encoding = encoding
  openDocuments.set(filePath, doc)
}

export function closeDocument(filePath: string) {
  openDocuments.delete(filePath)
  untrackFile(filePath)
}

function normalizeEOL(content: string, eol: string): string {
  return content.replace(/\r?\n/g, eol)
}
