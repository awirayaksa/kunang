// Builds dist/kunang-portable.exe — a single self-bootstrapping file.
//
// The output is the Go stub with a zip of electron-builder's unpacked output
// embedded in it. Run with no payload provisioned it extracts to
// %LOCALAPPDATA%\kunang\app\<version>, starts the host, and lets the host
// register the .md associations once it is warm. Run afterwards it is just the
// stub, on the fast pipe path.
//
// electron-builder's own `portable` target cannot do this: its NSIS template
// wipes and re-extracts the app on every launch and ExecWaits on it, which is
// incompatible with a resident host.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const stubDir = join(root, 'stub')
const distDir = join(root, 'dist')
const unpackedDir = join(distDir, 'win-unpacked')
const payloadZip = join(stubDir, 'payload.zip')

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const outExe = join(distDir, `kunang-portable-${version}.exe`)

// -H=windowsgui is mandatory: without it every .md double-click flashes a
// console window, since the stub *is* the registered handler.
const LDFLAGS_BASE = '-s -w -H=windowsgui'

function step(name, fn) {
  const t0 = Date.now()
  process.stdout.write(`> ${name}\n`)
  const result = fn()
  process.stdout.write(`  done in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`)
  return result
}

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', cwd: root, shell: false, ...opts })
}

// Call the tools' JS entry points directly rather than the .bin/*.cmd shims,
// which Node 22 refuses to spawn without shell: true.
function nodeBin(pkg, entry, args) {
  run(process.execPath, [join(root, 'node_modules', pkg, entry), ...args])
}

function mb(path) {
  return (statSync(path).size / 1024 / 1024).toFixed(1)
}

// Build the plain stub first — electron-builder picks it up as an extraResource,
// and it is the copy that ends up registered as the .md handler.
step('go build stub/kunangstub.exe', () => {
  run('go', ['build', '-ldflags', LDFLAGS_BASE, '-o', join(stubDir, 'kunangstub.exe'), '.'], {
    cwd: stubDir,
  })
})

step('electron-vite build', () =>
  nodeBin('electron-vite', 'bin/electron-vite.js', ['build']),
)

step('electron-builder --dir', () =>
  nodeBin('electron-builder', 'cli.js', ['--dir']),
)

step('zip win-unpacked -> stub/payload.zip', () => {
  rmSync(payloadZip, { force: true })
  mkdirSync(distDir, { recursive: true })

  // ZipFile::CreateFromDirectory rather than Compress-Archive: the latter is
  // unusably slow at this size. includeBaseDirectory=false so the zip root is
  // the app root, which is what bootstrap.go expects.
  const ps = [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    [
      'Add-Type -AssemblyName System.IO.Compression.FileSystem;',
      `[System.IO.Compression.ZipFile]::CreateFromDirectory(`,
      `'${unpackedDir}', '${payloadZip}',`,
      `[System.IO.Compression.CompressionLevel]::Optimal, $false)`,
    ].join(' '),
  ]
  run('powershell.exe', ps)
  process.stdout.write(`  payload: ${mb(payloadZip)} MB\n`)
})

// Identifies the payload, so the bootstrap can tell a rebuild from the build it
// already has installed. Version alone cannot: during development the version
// never moves, and the extracted app would silently stay at whatever was
// unpacked first.
const buildID = step('hash payload', () => {
  const id = createHash('sha256').update(readFileSync(payloadZip)).digest('hex').slice(0, 16)
  process.stdout.write(`  build id: ${id}\n`)
  return id
})

try {
  step('go build portable exe', () => {
    run(
      'go',
      [
        'build',
        '-tags',
        'portable',
        '-ldflags',
        `${LDFLAGS_BASE} -X main.version=${version} -X main.buildID=${buildID}`,
        '-o',
        outExe,
        '.',
      ],
      { cwd: stubDir },
    )
  })
} finally {
  // Never leave a stale multi-hundred-MB zip in the source tree.
  rmSync(payloadZip, { force: true })
}

process.stdout.write(`\n${outExe}  (${mb(outExe)} MB)\n`)
