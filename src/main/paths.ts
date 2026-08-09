import { existsSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'

/** %LOCALAPPDATA%\kunang — the version-independent home for stub, secret and payload. */
export function getDataDir(): string {
  const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
  return join(local, 'kunang')
}

/**
 * Locate a brand icon in both a packaged app and a dev run.
 *
 * Packaged, icons ship as extraResources under resourcesPath/icons. In dev,
 * __dirname is out/main, so the repo's resources/ sits two levels up. Deriving
 * it this way avoids importing electron here, keeping this module cheap.
 */
function iconSource(name: string): string {
  const resourcesPath = (process as any).resourcesPath
  if (resourcesPath) {
    const packaged = join(resourcesPath, 'icons', name)
    if (existsSync(packaged)) return packaged
  }
  return join(__dirname, '..', '..', 'resources', name)
}

/** Application icon — taskbar, Alt-Tab, window. */
export function getAppIconPath(): string {
  return iconSource('kunang.ico')
}

/**
 * The .md document icon, at a version-independent path.
 *
 * Registered as DefaultIcon, so like the stub it cannot live under
 * app\<version>\ — every upgrade would leave Explorer pointing at a path that
 * no longer exists, and .md files would silently lose their icon.
 */
export function getInstalledDocIconPath(): string {
  const dir = getDataDir()
  const installed = join(dir, 'kunang-md-notepad.ico')
  const source = iconSource('kunang-md-notepad.ico')

  try {
    if (!existsSync(installed)) {
      if (!existsSync(source)) return source
      mkdirSync(dir, { recursive: true })
      copyFileSync(source, installed)
    }
  } catch {
    // Fall back to the source path; a read-only data dir is not fatal here.
    return source
  }

  return installed
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
