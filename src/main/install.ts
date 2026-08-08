import { app, shell } from 'electron'
import { execFileSync } from 'child_process'
import { existsSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import { getInstalledStubPath } from './paths'

const APP_ID = 'com.kunang.app'
const EXE_PATH = process.execPath
const PIPE_DIR = join(process.env.LOCALAPPDATA || app.getPath('userData'), 'kunang')

const EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd', '.mdx']

const SYSTEM32 = join(process.env.SystemRoot || 'C:\\Windows', 'System32')
const REG_EXE = join(SYSTEM32, 'reg.exe')
const SCHTASKS_EXE = join(SYSTEM32, 'schtasks.exe')

/**
 * Argument array, not a shell string: the values here are command templates
 * containing their own quotes (`"C:\...\kunangstub.exe" "%1"`), and routing those
 * through cmd strips them — which silently breaks any path with a space in it,
 * i.e. every user whose name has one.
 */
function regAdd(key: string, valueName: string, value: string, type = 'REG_SZ') {
  const name = valueName === '' ? ['/ve'] : ['/v', valueName]
  // reg.exe rejects an empty /d argument; omitting /d writes empty data, which
  // is what the SupportedTypes markers want anyway.
  const data = value === '' ? [] : ['/d', value]
  execFileSync(REG_EXE, ['add', key, ...name, '/t', type, ...data, '/f'], {
    windowsHide: true,
  })
}

function regDelete(key: string) {
  try {
    execFileSync(REG_EXE, ['delete', key, '/f'], { windowsHide: true })
  } catch {
    // Key absent — nothing to undo.
  }
}

export function registerShell() {
  const stubPath = getInstalledStubPath()

  // HKCU class registration
  const classKey = `HKCU\\Software\\Classes\\Applications\\kunangstub.exe`
  regAdd(`${classKey}\\shell\\open\\command`, '', `"${stubPath}" "%1"`)
  regAdd(`${classKey}\\SupportedTypes`, '.md', '')
  regAdd(`${classKey}\\SupportedTypes`, '.markdown', '')
  regAdd(`${classKey}\\SupportedTypes`, '.mdown', '')
  regAdd(`${classKey}\\SupportedTypes`, '.mkd', '')
  regAdd(`${classKey}\\SupportedTypes`, '.mdx', '')

  // Associate extensions
  for (const ext of EXTENSIONS) {
    const extKey = `HKCU\\Software\\Classes\\${ext}`
    try {
      regAdd(extKey, '', 'kunang.md')
    } catch {
      // Key may already exist with a different association
    }
  }

  const appKey = 'HKCU\\Software\\Classes\\kunang.md'
  regAdd(appKey, '', 'Markdown Document')
  regAdd(`${appKey}\\shell\\open\\command`, '', `"${stubPath}" "%1"`)
  regAdd(`${appKey}\\DefaultIcon`, '', `"${stubPath}",0`)

  notifyShell(stubPath)
}

/**
 * Explorer caches the extension -> ProgId mapping, so writing the keys above
 * does not by itself change what a double-click does — without this the
 * association only takes effect at the next logon.
 */
function notifyShell(stubPath: string) {
  try {
    execFileSync(stubPath, ['--notify-assoc'], { windowsHide: true, timeout: 5000 })
  } catch {
    // Non-fatal: the keys are written, they just take effect later.
  }
}

/**
 * Optional: re-warm the host 30s after every login, so even the first .md open
 * after a reboot is fast. Not created by the portable bootstrap — a portable
 * app should not silently install an autostart task.
 */
export function registerLogonTask() {
  const taskXml = `
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <LogonTrigger>
      <Delay>PT30S</Delay>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${process.env.USERNAME}</UserId>
      <LogonType>InteractiveToken</LogonType>
    </Principal>
  </Principals>
  <Settings>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>"${EXE_PATH}"</Command>
      <Arguments>--preload</Arguments>
    </Exec>
  </Actions>
</Task>`

  const taskPath = join(PIPE_DIR, 'kunang-logon.xml')
  mkdirSync(dirname(taskPath), { recursive: true })
  writeFileSync(taskPath, taskXml, 'utf16le')
  execFileSync(SCHTASKS_EXE, ['/create', '/tn', 'kunang-logon', '/xml', taskPath, '/f'], {
    windowsHide: true,
  })
}

function unregisterShell() {
  // Capture the stub path before the keys go away — it is the thing that can
  // tell the shell to forget them.
  const stubPath = getInstalledStubPath()

  regDelete('HKCU\\Software\\Classes\\Applications\\kunangstub.exe')
  regDelete('HKCU\\Software\\Classes\\kunang.md')
  notifyShell(stubPath)
  try {
    execFileSync(SCHTASKS_EXE, ['/delete', '/tn', 'kunang-logon', '/f'], { windowsHide: true })
  } catch {
    // Task was never created (the portable path does not create one).
  }
}

export function install() {
  registerShell()
  registerLogonTask()
  console.log('kunang installed. Double-click .md files to open.')
}

/** Associations only — no autostart task. Used by the portable first-run path. */
export function installAssociationsOnly() {
  registerShell()
  console.log('kunang associations registered. Double-click .md files to open.')
}

export function uninstall() {
  unregisterShell()

  // Drop the provisioning markers so a later portable run re-registers cleanly.
  for (const name of ['registered', 'host', 'kunangstub.exe']) {
    const p = join(PIPE_DIR, name)
    try {
      if (existsSync(p)) unlinkSync(p)
    } catch {
      // kunangstub.exe may be locked by a stub that is still exiting; harmless.
    }
  }

  console.log('kunang uninstalled.')

  // The extracted app cannot delete itself while it is the running process.
  const appDir = join(PIPE_DIR, 'app')
  if (existsSync(appDir)) {
    console.log(`Remove the extracted app manually once kunang exits: ${appDir}`)
  }
}
