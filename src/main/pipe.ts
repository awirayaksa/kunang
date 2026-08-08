import * as net from 'net'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

const APPDATA_DIR = path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'kunang')
const PIPE_SECRET_FILE = path.join(APPDATA_DIR, 'pipe')

export interface PipePayload {
  argv: string[]
  cwd: string
  t0: number
}

function getOrCreateSecret(): string {
  if (!fs.existsSync(APPDATA_DIR)) {
    fs.mkdirSync(APPDATA_DIR, { recursive: true })
  }

  try {
    const existing = fs.readFileSync(PIPE_SECRET_FILE, 'utf8').trim()
    if (existing.length === 64) return existing
  } catch {
    // File doesn't exist, create it
  }

  const secret = crypto.randomBytes(32).toString('hex')
  fs.writeFileSync(PIPE_SECRET_FILE, secret, { mode: 0o600 })
  return secret
}

export function start(onPayload: (payload: PipePayload) => void): net.Server {
  const secret = getOrCreateSecret()
  const pipePath = `\\\\.\\pipe\\kunang.${secret}`

  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0)
    let expectedLength = -1

    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])

      while (true) {
        if (expectedLength < 0) {
          if (buffer.length < 4) break
          expectedLength = buffer.readUInt32LE(0)
          buffer = buffer.subarray(4)
        }

        if (buffer.length < expectedLength) break

        const message = buffer.subarray(0, expectedLength)
        buffer = buffer.subarray(expectedLength)
        expectedLength = -1

        try {
          const payload: PipePayload = JSON.parse(message.toString('utf8'))
          onPayload(payload)
        } catch (err) {
          console.error('Pipe: failed to parse payload', err)
        }
      }
    })

    socket.on('error', (err) => {
      console.error('Pipe socket error:', err)
    })
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.log('Another kunang host is already running. Exiting.')
      app.quit()
    } else {
      console.error('Pipe server error:', err)
    }
  })

  server.listen(pipePath)
  return server
}
