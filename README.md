# kunang

A Notepad-fast Markdown viewer and editor for Windows.

Double-clicking a `.md` file on Windows today either opens a plain text editor with
no rendering, or a heavyweight app — VS Code, Typora, Obsidian — that takes one to
three seconds to show anything. Neither fits the common case: glance at a rendered
document, occasionally fix a line, close it.

kunang opens a **rendered** `.md` file at Notepad speed, with a real two-pane live
preview editor one keystroke away.

```
Double-click .md   ->  rendered view mode, immediately
Ctrl+E             ->  edit mode: source left, live preview right
Ctrl+E or Esc      ->  back to view
```

## How it stays fast

A cold Electron window costs 800ms–2s. Notepad cold-opens in 80–200ms. kunang closes
that gap by making sure **the double-click path never boots Electron**.

```
double-click .md
   |
   v
kunangstub.exe  (Go, ~2.4MB)                       ~5ms
   |  CreateFile(\\.\pipe\kunang.<secret>)
   |  AllowSetForegroundWindow(hostPid)
   |  write {argv, cwd, t0}
   v
kunang.exe  (Electron main, resident)
   |  hands the payload to a pre-warmed hidden BrowserWindow
   |  renderer paints, acks
   v
win.show()
   |
   +--> immediately rebuilds a new hidden spare
```

The `.md` file association points at a tiny Go stub, not at Electron. The stub's only
job is to reach the already-running host in single-digit milliseconds. The host stays
resident after you close a window, so every open after the first is warm.

Electron's `requestSingleInstanceLock()` forwarding is deliberately **not** used — it
works by launching the whole app a second time to hand off `argv`, which puts full
Electron boot back on the double-click path.

**Target:** warm p95 ≤ 120ms from double-click to painted text. The benchmark harness
that proves this (`--bench`) is not built yet — see [Status](#status).

## Install

### Portable — single file, recommended

Download `kunang-portable-<version>.exe` (~145MB) and run it. On first run it:

1. Unpacks itself to `%LOCALAPPDATA%\kunang\app\<version>\` (~4s)
2. Starts the resident host
3. Registers `.md` associations **once the host is warm**

After that the portable exe has done its job. Double-clicking a `.md` runs only the
2.4MB stub — the host is already there. Closing a window leaves the host resident.

Running the portable exe again is a no-op if the host is up, and restarts it if not
(for example after a reboot).

> This is not a zero-footprint portable app. A resident host and a file association
> both need a stable path on disk, so it unpacks once and stays. `--uninstall` plus
> deleting `%LOCALAPPDATA%\kunang` removes it completely.

### Installer

`kunang Setup <version>.exe` — a per-user NSIS installer. Same result, plus a logon
task that re-warms the host 30 seconds after login, so even the first open after a
reboot is fast. The portable build deliberately does not create that task.

### Making it the default `.md` app

First run registers the associations for you. On a machine where you have **ever**
picked a default app for `.md`, Windows will ignore that registration:

```
HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.md\UserChoice
```

`UserChoice` carries a salted hash over the ProgId, extension and user SID.
Microsoft made it unforgeable specifically to stop apps hijacking associations, so
**no program can set it** — not kunang, not an installer running as admin. If it is
present, set the default yourself:

- Right-click a `.md` → **Open with** → **Choose another app** → kunang → *Always*
- or **Settings → Apps → Default apps**

Registration also fires `SHChangeNotify(SHCNE_ASSOCCHANGED)` via
`kunangstub.exe --notify-assoc`. Explorer caches the extension → ProgId mapping, so
without it the keys are written correctly but double-click keeps using the old
handler until the next logon.

## Usage

| Shortcut | Action |
|---|---|
| `Ctrl+E` | Toggle edit mode |
| `Esc` | Back out one level |
| `Ctrl+O` | Open file |
| `Ctrl+S` / `Ctrl+Shift+S` | Save / Save As |
| `Ctrl+\` | Toggle outline sidebar |
| `Ctrl+Shift+E` | Export self-contained HTML |
| `Ctrl+Shift+T` | Cycle theme (auto / light / dark) |
| `Ctrl` `+` / `-` / `0` | Zoom in / out / reset |
| `Ctrl+P` | Print |
| `F5` | Reload from disk |
| `Ctrl+W` | Close window (the host survives) |

**Tools** menu also has *Register / Unregister as default .md viewer*.

Markdown is markdown-it with GFM and highlight.js. Files round-trip their encoding
(UTF-8, UTF-16LE/BE with BOM sniffing, CP1252 fallback) and dominant line ending, so
git diffs stay clean. Saves are atomic via `ReplaceFileW`, preserving ACLs and
alternate streams. Open files are watched — a clean buffer reloads silently, a dirty
one prompts.

### Security

The renderer is sandboxed (`contextIsolation`, `sandbox: true`, no node integration)
and talks to main through a narrow `contextBridge` API. Rendered HTML goes through
DOMPurify. Local images and links are served over a custom `mdfile://` protocol with
a path guard; **all remote requests are blocked by default**, so a malicious `.md`
cannot phone home. External links open in your real browser.

The named pipe embeds a random 32-hex secret stored in `%LOCALAPPDATA%\kunang\pipe`.
Node cannot set pipe ACLs, so the unguessable name is what stops another user's
process from driving your host.

## Build from source

Requires **Node 20.19+ or 22.12+** and **Go 1.21+**.

```bash
npm install

npm run dev               # electron-vite dev server
npm test                  # unit tests
npm run build:stub        # just the Go stub (fast iteration)

npm run package:portable  # -> dist/kunang-portable-<version>.exe
npm run package           # -> dist/kunang Setup <version>.exe  (NSIS)
```

`npm run package:portable` runs six steps in order:

1. `go build` → `stub/kunangstub.exe`, the payload-free stub
2. `electron-vite build`
3. `electron-builder --dir` → `dist/win-unpacked/`
4. Zip that into `stub/payload.zip`
5. `go build -tags portable` → embeds the zip, stamps the version
6. Delete `payload.zip`

Step 1 must precede step 3: electron-builder picks the stub up as an `extraResource`,
and that is the copy the bootstrapper later installs as the registered handler.

> `-H=windowsgui` in the Go link flags is not optional. Without it every `.md`
> double-click flashes a console window, because the stub *is* the handler.

### Why not `electron-builder`'s portable target

Its NSIS template does `RMDir /r $INSTDIR` → extract → `ExecWait` → `RMDir /r $INSTDIR`.
That re-extracts the whole app on every launch, blocks a wrapper process for the app's
entire lifetime, and lets a second launch delete the app out from under a running host.
All three are fatal to a resident host, and `PortableOptions` exposes no script
override. `scripts/build-portable.mjs` replaces it: the single file is the Go stub with
the app zip embedded, so the same binary is both the bootstrapper and the handler.

## Layout

```
stub/                  Go — the only non-TypeScript code
  main.go              role dispatch, pipe connect, foreground grant, argv write
  bootstrap.go         portable first run: extract, provision, start host
  payload.go           //go:build portable — embeds payload.zip
  notify.go            SHChangeNotify helper for association changes
  replace_windows.go   ReplaceFileW helper for atomic saves
src/main/              Electron main: pipe server, warm-spare pool, file I/O,
                       watcher, mdfile:// protocol, install/registration
src/preload/           contextBridge — the security boundary
src/renderer/          markdown-it render, CodeMirror 6 editor, morphdom live
                       preview, scroll sync, outline, HTML export
tests/                 unit tests + a deliberately hostile .md corpus
scripts/               build-portable.mjs
```

## Status

Pre-1.0 and under active development. Working: the resident-host fast path, portable
single-file build, view and edit modes, encoding round-trip, atomic save, file
watching, outline, HTML export, theming.

Not yet done:

- `--bench` harness and the warm p95 ≤ 120ms gate
- Ctrl+F find bar in view mode, dirty indicator, scroll position restore
- Lazy KaTeX and Mermaid, large-file guard, `custom.css`, drag & drop
- Remote content consent bar
- `idleTimeoutMinutes` — the setting is read from `state.json` but not acted on

### Known caveats

- **Windows only.** The stub is Win32-specific: named pipes, `ReplaceFileW`,
  `AllowSetForegroundWindow`.
- **SmartScreen.** The portable exe is unsigned, self-extracting, and writes HKCU.
  Expect a SmartScreen prompt until it is code-signed.
- **Footprint.** ~370MB unpacked, ~200MB resident at idle plus 60–80MB per window.
  That is the price of TypeScript instead of C++. `state.json` reserves an
  `idleTimeoutMinutes` escape hatch to trade speed back for memory, but nothing
  acts on it yet.
- **Silent first run.** The portable exe is a GUI-subsystem binary, so unpacking
  shows nothing until the host is up. Failures surface as a message box.

## License

MIT
