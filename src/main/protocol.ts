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

  // Block all non-mdfile requests by default
  ses.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url
    if (
      url.startsWith('mdfile://') ||
      url.startsWith('devtools://') ||
      url.startsWith('file://') ||
      url.startsWith('http://localhost:')
    ) {
      callback({})
    } else {
      callback({ cancel: true })
    }
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
