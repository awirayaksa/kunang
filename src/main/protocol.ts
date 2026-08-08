import { BrowserWindow, app, shell, webContents, session } from 'electron'
import { net } from 'electron'
import { readFile, stat } from 'fs/promises'
import { extname, resolve, dirname } from 'path'
import { getWindow } from './windows'

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
}

// webContents ids whose user has consented to remote content for the document
// currently open in them. Deliberately not persisted: consent is re-asked on
// every open, so the safe state is the one you get by default.
const remoteAllowed = new Set<number>()

export function allowRemoteFor(webContentsId: number) {
  remoteAllowed.add(webContentsId)
}

/** Revoke on navigation to another document — consent was for that file. */
export function revokeRemoteFor(webContentsId: number) {
  remoteAllowed.delete(webContentsId)
}

export function registerProtocol() {
  const ses = session.defaultSession

  ses.protocol.handle('mdfile', async (request) => {
    const url = new URL(request.url)
    const filePath = decodeURIComponent(url.pathname.replace(/^\//, ''))

    try {
      const s = await stat(filePath)
      if (!s.isFile()) {
        return new Response('Not found', { status: 404 })
      }

      const ext = extname(filePath).toLowerCase()
      const mimeType = MIME[ext] || 'application/octet-stream'
      const data = await readFile(filePath)

      return new Response(data, {
        status: 200,
        headers: { 'content-type': mimeType, 'cache-control': 'no-cache' },
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })

  // Block all non-mdfile requests by default. A markdown file is untrusted
  // input, and a remote image is enough to leak that the document was opened,
  // along with the reader's IP address.
  ses.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url

    if (
      url.startsWith('mdfile://') ||
      url.startsWith('devtools://') ||
      url.startsWith('file://') ||
      url.startsWith('http://localhost:')
    ) {
      callback({})
      return
    }

    // Remote content is permitted only for a window whose user explicitly
    // consented, and only until that window loads a different document.
    if (
      (url.startsWith('https://') || url.startsWith('http://')) &&
      details.webContentsId !== undefined &&
      remoteAllowed.has(details.webContentsId)
    ) {
      callback({})
      return
    }

    callback({ cancel: true })
  })

  // External links open in browser
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (!url.startsWith('mdfile://')) {
        shell.openExternal(url)
      }
      return { action: 'deny' }
    })

    contents.on('will-navigate', (event, url) => {
      if (!url.startsWith('mdfile://') && !url.startsWith('devtools://')) {
        event.preventDefault()
        shell.openExternal(url)
      }
    })
  })
}

export function readLocalFile(filePath: string): Promise<Buffer> {
  return readFile(filePath)
}
