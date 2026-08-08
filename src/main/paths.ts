import { existsSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'

/** %LOCALAPPDATA%\kunang — the version-independent home for stub, secret and payload. */
export function getDataDir(): string {
  const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
  return join(local, 'kunang')
}

/** Optional user stylesheet, appended to the document's own styles. */
export function getCustomCssPath(): string {
  return join(getDataDir(), 'custom.css')
}

/** Contents of custom.css, or null when absent. */
export function readCustomCss(): string | null {
  try {
    const css = readFileSync(getCustomCssPath(), 'utf8')
    return css.trim() ? css : null
  } catch {
    // Absent is the normal case, not an error.
    return null
  }
}

export function getStubPath(): string {
  // Packaged: stub is in extraResources (resourcesPath/stub/kunangstub.exe)
  const resourcesPath = (process as any).resourcesPath
  if (resourcesPath) {
    const p = join(resourcesPath, 'stub', 'kunangstub.exe')
    if (existsSync(p)) return p
  }

  // Dev: stub is in stub/ directory relative to project root
  const devPath = join(dirname(process.execPath), 'stub', 'kunangstub.exe')
  if (existsSync(devPath)) return devPath

  // Fallback
  return devPath
}

/**
 * The stub copy that gets registered as the .md handler.
 *
 * Must live at a version-independent path: the app itself may sit under
 * app\<version>\, and re-registering on every upgrade would be fragile. Copies
 * from the packaged stub on first call.
 */
export function getInstalledStubPath(): string {
  const dir = getDataDir()
  const installed = join(dir, 'kunangstub.exe')

  if (!existsSync(installed)) {
    const source = getStubPath()
    if (!existsSync(source)) return source
    mkdirSync(dir, { recursive: true })
    copyFileSync(source, installed)
  }

  return installed
}

/**
 * Pointer file naming the resident host executable, read by kunangstub's
 * self-healing spawn. The stub cannot assume kunang.exe is its sibling —
 * in a portable install the stub lives in the data dir and the host under
 * app\<version>\.
 */
export function writeHostPointer(): void {
  const dir = getDataDir()
  const pointer = join(dir, 'host')

  try {
    if (readFileSync(pointer, 'utf8').trim() === process.execPath) return
  } catch {
    // Missing or unreadable — write it below.
  }

  mkdirSync(dir, { recursive: true })
  writeFileSync(pointer, process.execPath, 'utf8')
}
