// Rasterises the brand SVGs into multi-resolution Windows .ico files.
//
//   npm run gen:icons
//
// Runs under Electron rather than a native image library on purpose: Chromium
// is already a dependency and renders these SVGs exactly the way the app will,
// so there is no second rasteriser to disagree with the first. Adding sharp or
// ImageMagick just for a build step would be a heavier answer to a smaller
// question.
//
// BRAND.md asks for small layers to be supersampled and downscaled rather than
// rendered directly at size, so everything is drawn once at 1024 and reduced
// with Chromium's own 'best' filter.

import { app, BrowserWindow, nativeImage } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const resources = join(root, 'resources')

// Everything Explorer, the taskbar, Alt-Tab and the Start menu ask for.
const SIZES = [16, 24, 32, 48, 64, 128, 256]
const SUPERSAMPLE = 1024

const TARGETS = [
  { svg: 'kunang-md-tile.svg', ico: 'kunang.ico', label: 'application icon' },
]

function html(svg) {
  const data = Buffer.from(svg, 'utf8').toString('base64')
  return `<!doctype html>
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  img { display: block; width: ${SUPERSAMPLE}px; height: ${SUPERSAMPLE}px; }
</style>
<img src="data:image/svg+xml;base64,${data}">`
}

async function rasterise(svgPath) {
  const svg = readFileSync(svgPath, 'utf8')

  const win = new BrowserWindow({
    width: SUPERSAMPLE,
    height: SUPERSAMPLE,
    useContentSize: true,
    show: false,
    frame: false,
    // The tile has rounded corners; without transparency they come back black.
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true },
  })

  await win.loadURL('data:text/html;base64,' + Buffer.from(html(svg), 'utf8').toString('base64'))

  // One frame to settle before capturing, or the capture can come back empty.
  await new Promise((r) => setTimeout(r, 300))

  let image = await win.webContents.capturePage()
  win.destroy()

  // On a scaled display the capture comes back in device pixels, so normalise
  // before deriving the layers.
  const { width } = image.getSize()
  if (width !== SUPERSAMPLE) {
    image = image.resize({ width: SUPERSAMPLE, height: SUPERSAMPLE, quality: 'best' })
  }

  return image
}

/**
 * Assemble PNG buffers into an .ico.
 *
 * Layers are stored as PNG rather than BMP: every Windows version that matters
 * reads PNG-in-ICO, and it keeps the 256px layer from costing 256KB.
 */
function buildIco(layers) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type 1 = icon
  header.writeUInt16LE(layers.length, 4)

  const directory = Buffer.alloc(16 * layers.length)
  let offset = header.length + directory.length

  layers.forEach((layer, i) => {
    const at = i * 16
    // 0 means 256 in a single byte field.
    directory.writeUInt8(layer.size >= 256 ? 0 : layer.size, at)
    directory.writeUInt8(layer.size >= 256 ? 0 : layer.size, at + 1)
    directory.writeUInt8(0, at + 2) // palette size, 0 for truecolour
    directory.writeUInt8(0, at + 3) // reserved
    directory.writeUInt16LE(1, at + 4) // colour planes
    directory.writeUInt16LE(32, at + 6) // bits per pixel
    directory.writeUInt32LE(layer.data.length, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += layer.data.length
  })

  return Buffer.concat([header, directory, ...layers.map((l) => l.data)])
}

async function main() {
  for (const target of TARGETS) {
    const svgPath = join(resources, target.svg)
    const master = await rasterise(svgPath)

    const layers = SIZES.map((size) => ({
      size,
      data: master.resize({ width: size, height: size, quality: 'best' }).toPNG(),
    }))

    const ico = buildIco(layers)
    const outPath = join(resources, target.ico)
    writeFileSync(outPath, ico)

    process.stdout.write(`${target.ico}  (${target.label}) from ${target.svg}\n`)
    for (const layer of layers) {
      process.stdout.write(`  ${String(layer.size).padStart(3)}px  ${String(layer.data.length).padStart(7)} bytes\n`)
    }
    process.stdout.write(`  total ${ico.length} bytes\n\n`)
  }
}

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  try {
    await main()
    app.exit(0)
  } catch (err) {
    console.error(err)
    app.exit(1)
  }
})
