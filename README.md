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

**Target:** warm p95 ≤ 120ms from double-click to painted text.

`npm run bench` measures it by launching the real stub 50 times — the same binary
Explorer runs on a double-click — so the numbers include process creation and the
pipe handshake. Measured on the development machine:

| Hop | p50 | p95 |
|---|---|---|
| stub entry → pipe read | 13.6ms | 16.7ms |
| → dispatched to renderer | +0.0ms | |
| → renderer painted | +15.4ms | |
| → window shown | +17.5ms | |
| **total** | **47.0ms** | **57.3ms** |

Cold, with no host running, bringing the host up takes ~960ms; the first open after
that is 59.6ms. `npm run bench -- --cold` measures that path.

Numbers move a few milliseconds between runs depending on machine load — treat the
gate, not the exact figure, as the contract.

## Install

### Portable — single file, recommended

Download `kunang-portable-<version>.exe` (~144MB) and run it. On first run it:

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
| `Ctrl+F` | Find in page (edit mode uses CodeMirror's own search) |
| `Esc` | Back out one level — find bar, then edit mode, then the window |
| `Ctrl+O` | Open file |
| `Ctrl+S` / `Ctrl+Shift+S` | Save / Save As |
| `Ctrl+\` | Toggle outline sidebar |
| `Ctrl+Shift+E` | Export self-contained HTML |
| `Ctrl+Shift+T` | Cycle theme (auto / light / dark) |
| `Ctrl` `+` / `-` / `0` | Zoom in / out / reset |
| `Ctrl+P` | Print |
| `F5` | Reload from disk (also re-reads `custom.css`) |
| `Ctrl+W` | Close window (the host survives) |

**Tools** menu also has *Register / Unregister as default .md viewer*.

Drop a `.md` file anywhere to open it. Drop images while in edit mode to insert them
as markdown, linked relative to the open document.

Markdown is markdown-it with GFM and highlight.js. Math (`$…$`, `$$…$$`) and
```` ```mermaid ```` diagrams render via KaTeX and Mermaid, which are **imported only
when a document actually contains them** — the double-click path never pays for
features the document does not use. Documents over 5MB skip syntax highlighting and
say so, rather than wedging the renderer.

Files round-trip their encoding (UTF-8, UTF-16LE/BE with BOM sniffing, CP1252
detected by validating the bytes) and their dominant line ending, so git diffs stay
clean. A CP1252 file that gains a character its encoding cannot represent is promoted
to UTF-8 rather than having that character replaced with `?`.

Saves are atomic via `ReplaceFileW`, preserving ACLs and alternate streams. Open files
are watched: a clean buffer reloads silently, a dirty one tells you and waits. Deleting
the file keeps the buffer — at that point it is the only copy left. Renaming it is
followed, and the title updates. Closing with unsaved changes prompts.

Scroll position is remembered per file. Drop a stylesheet at
`%LOCALAPPDATA%\kunang\custom.css` to restyle the document.

### Security

The renderer is sandboxed (`contextIsolation`, `sandbox: true`, no node integration)
and talks to main through a narrow `contextBridge` API. Rendered HTML goes through
DOMPurify. Local images and links are served over a custom `mdfile://` protocol.

**All remote requests are blocked by default**, so a malicious `.md` cannot phone
home — a single remote `<img>` is enough to report that a document was opened, and
from which IP address. When a document wants remote content, a bar says how many
and offers to load them. That consent is per window and per document, and is
deliberately **not** persisted: the safe state is the one you get by doing nothing.

Mermaid runs with `securityLevel: 'strict'` and KaTeX with `throwOnError: false`,
since both are handed text straight from an untrusted document. External links open
in your real browser.

The named pipe embeds a random 32-hex secret stored in `%LOCALAPPDATA%\kunang\pipe`.
Node cannot set pipe ACLs, so the unguessable name is what stops another user's
process from driving your host.

## Build from source

Requires **Node 20.19+ or 22.12+** and **Go 1.21+**.

```bash
npm install

npm run dev               # electron-vite dev server
npm test                  # unit tests
npm run typecheck         # tsc --noEmit
npm run build:stub        # just the Go stub (fast iteration)
npm run gen:corpus        # regenerate the encoding fixtures + 2mb.md
npm run bench             # 50 warm opens, checks the p95 gate

npm run package:portable  # -> dist/kunang-portable-<version>.exe
npm run package           # -> dist/kunang Setup <version>.exe  (NSIS)
npm run release           # bump, tag, push — CI builds and publishes
```

Releases are cut with `npm run release` (`-- minor`, `-- major`, or an exact
`x.y.z`). It refuses to run on a dirty tree, off `main`, or out of sync with the
remote, then bumps, tags and pushes. Pushing the tag is what builds: a Windows
runner produces the portable exe and attaches it to the GitHub release.

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

## Brand

A firefly's flight path traces an `M`. Full guide in
[`resources/BRAND.md`](resources/BRAND.md) — palette, lockups, clear space and the
things not to do.

Two hues only, night and amber. The one place amber moves is the editor caret, and
that restraint is deliberate. `view.css` defines the palette as tokens
(`--night-900`, `--amber-400`, `--glow`, `--paper`) and everything else derives from
them, so nothing in the UI introduces a third brand colour.

| Asset | Use |
|---|---|
| `resources/kunang.ico` | Application: taskbar, Alt-Tab, installer, window |
| `resources/kunang-md-notepad.ico` | `.md` documents in Explorer |

The two are kept distinct on purpose — the same split Windows uses for Word and
`.docx`. The document icon is copied to `%LOCALAPPDATA%\kunang\` and registered as
`DefaultIcon` from there, since a path under `app\<version>\` would break on upgrade.

`npm run gen:icons` regenerates `kunang.ico` from the brand SVG. It rasterises under
Electron rather than pulling in an image library, so the icon is rendered by the same
engine that draws the app.

> The app icon is currently derived from `kunang-md-tile.svg`. The brand guide calls
> for a distinct application mark (`kunang-mark.svg`, the firefly trail without the
> document sheet), which is not yet in `resources/`. Drop it in and point
> `gen-icons.mjs` at it to swap.

## Layout

```
stub/                  Go — the only non-TypeScript code
  main.go              role dispatch, pipe connect, foreground grant, argv write
  bootstrap.go         portable first run: extract, provision, start host
  payload.go           //go:build portable — embeds payload.zip
  notify.go            SHChangeNotify helper for association changes
  replace_windows.go   ReplaceFileW helper for atomic saves
src/main/              Electron main: pipe server, warm-spare pool, file I/O,
                       watcher, mdfile:// protocol, install/registration,
                       close guard, bench instrumentation
src/preload/           contextBridge — the security boundary
src/renderer/          markdown-it render, CodeMirror 6 editor, morphdom live
                       preview, scroll sync, find, outline, HTML export,
                       lazy KaTeX/Mermaid
tests/                 unit tests + a deliberately hostile .md corpus
scripts/               build-portable, release, bench, gen-corpus
```

## Status

Pre-1.0 but feature-complete against its original plan. Working: the resident-host
fast path, portable single-file build, view and edit modes, find, encoding
round-trip, atomic save, file watching with delete and rename handling, outline,
HTML export, theming, lazy math and diagrams, drag & drop, `custom.css`, and the
benchmark gate.

Not yet done:

- NSIS installer is built but not exercised; only the portable build is released
- Multiple-window stress test, taskbar grouping, network-drive and WSL paths
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
- **Rename detection is a heuristic.** Windows reports a rename as an unrelated
  unlink followed by an add, so they are paired by proximity in time within the
  same directory. Deleting one file and creating another inside that window looks
  identical. It errs toward following the file, since the alternative is claiming
  a document vanished when it did not.
- **Silent first run.** The portable exe is a GUI-subsystem binary, so unpacking
  shows nothing until the host is up. Failures surface as a message box.

## License

MIT
