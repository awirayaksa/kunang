# Verifies that Ctrl+Tab and Ctrl+Shift+Tab actually switch tabs.
#
#   npm run build
#   powershell -ExecutionPolicy Bypass -File scripts/verify-ctrl-tab.ps1
#
# Chromium reserves Ctrl+Tab and never delivers it to the page, so kunang
# declares it as a menu accelerator (src/main/menu.ts) instead of a renderer
# keydown. That route could not be checked from a unit test, which is why the
# item sat unverified: it only exists once there is a real window, a real
# native menu, and a real keystroke.
#
# So this drives all three. Keys go in through SendKeys, which posts to the
# foreground window exactly as the keyboard does, and the result is read back
# off the window title -- the renderer already puts the active tab's file name
# there (updateTitle in src/renderer/main.ts), so no test hook is needed in
# the app itself.
#
# The host under test is a dev run of out/, not the installed kunang. The two
# files it would otherwise disturb -- the host pointer and the saved session --
# are restored on the way out.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName Microsoft.VisualBasic

$root = Split-Path -Parent $PSScriptRoot
$dataDir = Join-Path $env:LOCALAPPDATA 'kunang'
$stub = Join-Path $root 'stub\kunangstub.exe'
$docA = Join-Path $root 'tests\corpus\crlf.md'
$docB = Join-Path $root 'tests\corpus\xss.md'

$failures = 0

function Say($msg) { Write-Host $msg }

function Check($label, $expected, $actual) {
  if ($expected -eq $actual) {
    Say "  PASS  $label  (title: '$actual')"
  } else {
    Say "  FAIL  $label  expected '$expected', got '$actual'"
    $script:failures++
  }
}

# --- Preconditions ---------------------------------------------------------

foreach ($p in @($stub, $docA, $docB, (Join-Path $root 'out\main\index.js'))) {
  if (-not (Test-Path $p)) { throw "missing $p (run npm run build / npm run build:stub)" }
}

# --- Back up the state this test would otherwise trample ------------------

$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'

$hostPointer = Join-Path $dataDir 'host'
$stateFile = Join-Path $dataDir 'state.json'

# Bytes, not text. Set-Content -Encoding utf8 writes a BOM on Windows
# PowerShell 5.1, and a host pointer that begins with one names a path that
# does not exist -- which leaves the installed kunang unable to start at all.
$backup = @{}
foreach ($f in @($hostPointer, $stateFile)) {
  if (Test-Path $f) { $backup[$f] = [System.IO.File]::ReadAllBytes($f) }
}

# The host writes its own path here on startup, so a dev host that was run
# outside this script has already overwritten it. Restoring that value would
# preserve the damage rather than undo it.
if (Test-Path $hostPointer) {
  $pointed = [System.IO.File]::ReadAllText($hostPointer).Trim()
  if ($pointed -eq $electron) {
    Write-Host "WARNING: $hostPointer already names the dev host."
    Write-Host '         Run the portable exe once afterwards to point it back at the installed host.'
  }
}
$hostProc = $null

function Get-KunangWindowProc {
  # Only the browser process owns a visible top-level window; the renderer and
  # GPU processes report an empty title. The warm spare is hidden, so it does
  # not answer here either. Found by asking rather than by trusting the pid
  # Start-Process handed back -- that one is not always the browser process.
  $procs = Get-Process -Name electron -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle -ne '' }
  if (-not $procs) { return $null }
  return @($procs)[0]
}

function Get-KunangTitle {
  $proc = Get-KunangWindowProc
  if (-not $proc) { return '' }
  return $proc.MainWindowTitle
}

function Wait-Title($want, $timeoutMs = 8000) {
  $deadline = (Get-Date).AddMilliseconds($timeoutMs)
  while ((Get-Date) -lt $deadline) {
    if ((Get-KunangTitle) -eq $want) { return $true }
    Start-Sleep -Milliseconds 150
  }
  return $false
}

function Stop-DevHost {
  # Killed by path rather than asked over the pipe: a --quit sent to a dead
  # host makes the stub spawn the installed one to receive it.
  Get-Process -Name electron -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $electron } |
    Stop-Process -Force -ErrorAction SilentlyContinue
}

function Stop-InstalledHost {
  & $stub '--quit' | Out-Null

  # The stub spawns the installed host whenever it cannot reach one, so a
  # --quit against a host that is already gone briefly starts a new one. Let
  # that finish before checking, or the dev host loses the pipe election to a
  # host that appeared a second after it was asked to leave.
  Start-Sleep -Seconds 4
  Get-Process -Name kunang -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 800
}

function Send-Keystroke($keys) {
  # Foreground first: SendKeys posts to whatever window has focus, and this
  # script's own console is a candidate otherwise.
  $proc = Get-KunangWindowProc
  if (-not $proc) { throw 'the kunang window disappeared' }

  [Microsoft.VisualBasic.Interaction]::AppActivate($proc.Id) | Out-Null
  Start-Sleep -Milliseconds 400
  [System.Windows.Forms.SendKeys]::SendWait($keys)
  Start-Sleep -Milliseconds 700
}

try {
  Say "host:  $electron"
  Say "docs:  $docA`n       $docB`n"

  # Any resident host would win the pipe election and serve the opens instead
  # of the build being tested.
  Say 'Stopping any resident host...'
  Stop-InstalledHost
  Stop-DevHost

  # --preload, so the host comes up windowless and waits on the pipe. Without
  # it Electron reads the app directory itself as the file to open, and the
  # first thing on screen is an error page.
  Say 'Starting the host from out/...'
  $hostProc = Start-Process -FilePath $electron -ArgumentList $root, '--preload' -PassThru
  Start-Sleep -Seconds 6

  # The whole test is worthless if something else answered the pipe.
  if (Get-Process -Name kunang -ErrorAction SilentlyContinue) {
    throw 'the installed kunang host is running; it would serve the opens instead of the build under test'
  }
  if (-not (Get-Process -Name electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $electron })) {
    throw 'the dev host exited on startup -- it probably lost the pipe election'
  }

  # Two documents, one window: every open goes to the last-focused window.
  Say "Opening two documents...`n"
  & $stub $docA | Out-Null
  if (-not (Wait-Title 'crlf.md')) {
    throw "the host never served the first document (title: '$(Get-KunangTitle)')"
  }

  & $stub $docB | Out-Null

  if (-not (Wait-Title 'xss.md')) {
    throw "window never showed the second document (title: '$(Get-KunangTitle)')"
  }

  Say 'Ctrl+Tab / Ctrl+Shift+Tab'

  # Two tabs, so next and previous both land on the other one; the direction
  # is proved by the third press, which has to come back rather than go on.
  Send-Keystroke '^{TAB}'
  Check 'Ctrl+Tab moves to the next tab' 'crlf.md' (Get-KunangTitle)

  Send-Keystroke '^{TAB}'
  Check 'Ctrl+Tab wraps back round' 'xss.md' (Get-KunangTitle)

  Send-Keystroke '^+{TAB}'
  Check 'Ctrl+Shift+Tab moves to the previous tab' 'crlf.md' (Get-KunangTitle)

  Say "`nCtrl+PageDown / Ctrl+PageUp (the renderer route, for comparison)"

  Send-Keystroke '^{PGDN}'
  Check 'Ctrl+PageDown moves to the next tab' 'xss.md' (Get-KunangTitle)

  Send-Keystroke '^{PGUP}'
  Check 'Ctrl+PageUp moves to the previous tab' 'crlf.md' (Get-KunangTitle)
}
finally {
  Say "`nStopping the host..."
  Stop-DevHost
  if ($hostProc -and -not $hostProc.HasExited) {
    Stop-Process -Id $hostProc.Id -Force -ErrorAction SilentlyContinue
  }

  # After the host is down, so its flush-on-exit cannot land on top of the
  # restore.
  Start-Sleep -Milliseconds 800
  foreach ($f in $backup.Keys) {
    [System.IO.File]::WriteAllBytes($f, $backup[$f])
  }
  Say 'Restored the host pointer and saved session.'
}

if ($failures -gt 0) {
  Say "`n$failures check(s) failed."
  exit 1
}

Say "`nAll checks passed."
