package main

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// version is stamped at build time via -ldflags "-X main.version=...".
var version = "dev"

// buildID identifies the exact payload this binary carries — a hash of
// payload.zip, stamped alongside version.
//
// The extraction marker records it, so a rebuild that keeps the same version
// still replaces what is on disk. Keying provisioning on the version alone
// meant every rebuild during development silently kept serving the previous
// build, and a released patch that reused a version number would have done the
// same on users' machines.
var buildID = "dev"

// Written last, so a half-finished extraction never looks complete.
const completeMarker = ".complete"

var procMessageBoxW = user32.NewProc("MessageBoxW")

const mbIconError = 0x00000010

// showError is the only way a -H=windowsgui binary can report a failure. Used
// solely on the bootstrap path; the hot .md path stays silent by design.
func showError(msg string) {
	text, err := windows.UTF16PtrFromString(msg)
	if err != nil {
		return
	}
	caption, err := windows.UTF16PtrFromString("kunang")
	if err != nil {
		return
	}
	procMessageBoxW.Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(caption)), mbIconError)
}

// dataDir is %LOCALAPPDATA%\kunang — home of the pipe secret, the registered
// stub copy, the host pointer, and the extracted app.
func dataDir() (string, error) {
	appdata := os.Getenv("LOCALAPPDATA")
	if appdata == "" {
		return "", fmt.Errorf("LOCALAPPDATA not set")
	}
	return filepath.Join(appdata, "kunang"), nil
}

func appDir() (string, error) {
	dir, err := dataDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "app", version), nil
}

// isCurrentBuild reports whether the payload already on disk is the one this
// binary carries. A marker from an older build — or from before markers
// recorded a build id at all — reads as stale and triggers a replacement.
func isCurrentBuild() bool {
	dir, err := appDir()
	if err != nil {
		return false
	}

	data, err := os.ReadFile(filepath.Join(dir, completeMarker))
	if err != nil {
		return false
	}

	return strings.TrimSpace(string(data)) == buildID
}

func hostExe() (string, error) {
	dir, err := appDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "kunang.exe"), nil
}

// installPayload unzips into a per-process temp directory and renames it into
// place. Rename is the commit point: two concurrent runs both extract, but only
// one lands, and the loser discards its copy.
func installPayload(dst string) error {
	data := payloadBytes()
	if len(data) == 0 {
		return fmt.Errorf("no embedded payload")
	}

	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return err
	}

	tmp := fmt.Sprintf("%s.tmp-%d", dst, os.Getpid())
	if err := os.RemoveAll(tmp); err != nil {
		return err
	}
	defer os.RemoveAll(tmp)

	for _, f := range zr.File {
		if err := extractEntry(f, tmp); err != nil {
			return err
		}
	}

	if err := os.WriteFile(filepath.Join(tmp, completeMarker), []byte(buildID), 0o644); err != nil {
		return err
	}

	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}

	// Move any previous build aside first. Windows will not rename onto an
	// existing directory, and this is the step that makes a rebuild at an
	// unchanged version actually replace what is installed.
	stale := ""
	if _, err := os.Stat(dst); err == nil {
		stale = fmt.Sprintf("%s.old-%d", dst, os.Getpid())
		if err := os.Rename(dst, stale); err != nil {
			return fmt.Errorf(
				"could not replace the installed app.\n\n"+
					"Something is still holding %s open. Close kunang and try again.\n\n%w", dst, err)
		}
	}

	if err := os.Rename(tmp, dst); err != nil {
		if stale != "" {
			// Put the working copy back rather than leaving nothing installed.
			_ = os.Rename(stale, dst)
		}
		// Another instance almost certainly won the race. Its copy is as good
		// as ours, so defer to it rather than fighting over the directory.
		if isCurrentBuild() {
			return nil
		}
		return err
	}

	if stale != "" {
		// Best effort: a leftover .old- directory is untidy but harmless, and
		// failing the upgrade over it would not be.
		_ = os.RemoveAll(stale)
	}

	return nil
}

func extractEntry(f *zip.File, root string) error {
	// Reject entries that would escape the destination (zip-slip).
	name := filepath.FromSlash(f.Name)
	target := filepath.Join(root, name)
	if !strings.HasPrefix(target, filepath.Clean(root)+string(os.PathSeparator)) {
		return fmt.Errorf("illegal path in payload: %s", f.Name)
	}

	if f.FileInfo().IsDir() {
		return os.MkdirAll(target, 0o755)
	}

	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}

	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()

	out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, f.Mode()|0o200)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, rc)
	return err
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	tmp := dst + ".tmp"
	out, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}

	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	out.Close()

	if err := os.Rename(tmp, dst); err != nil {
		os.Remove(tmp)
		return err
	}
	return nil
}

// provision puts the two version-independent artifacts in place: the stub copy
// that gets registered as the .md handler, and the pointer to the host exe.
func provision() error {
	dir, err := dataDir()
	if err != nil {
		return err
	}
	app, err := appDir()
	if err != nil {
		return err
	}

	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	src := filepath.Join(app, "resources", "stub", "kunangstub.exe")
	dst := filepath.Join(dir, "kunangstub.exe")
	if _, err := os.Stat(src); err == nil {
		// Skip if the running host is using it — a failed copy here is not
		// fatal, the existing copy stays valid.
		_ = copyFile(src, dst)
	}

	host, err := hostExe()
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "host"), []byte(host), 0o644)
}

// spawnPortableHost starts the extracted host detached, with --portable so it
// registers the file associations once it is fully warm.
func spawnPortableHost() error {
	host, err := hostExe()
	if err != nil {
		return err
	}

	cmd := exec.Command(host, "--preload", "--portable")
	cmd.Dir = filepath.Dir(host)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP,
	}
	return cmd.Start()
}

// waitForHost polls until the host's named pipe accepts a connection, so that
// a .md passed on the same command line is not written into the void. Probes
// once before consulting the deadline, so a zero timeout means "check now".
func waitForHost(timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for {
		if secret, err := getPipeSecret(); err == nil {
			if h, err := connectPipe(secret); err == nil {
				windows.CloseHandle(windows.Handle(h))
				return true
			}
		}
		if !time.Now().Before(deadline) {
			return false
		}
		time.Sleep(100 * time.Millisecond)
	}
}

// quitResidentHost asks a running host to exit and waits for it to let go.
//
// An upgrade cannot proceed around a live host: it holds kunang.exe and the
// asar open, so the directory cannot be renamed, and even if it could, the old
// process would carry on serving every double-click from code that is no
// longer on disk.
func quitResidentHost() error {
	secret, err := getPipeSecret()
	if err != nil {
		// No secret file means no host has ever run here.
		return nil
	}

	h, errno := connectPipeRaw(secret)
	if h == INVALID_HANDLE_VALUE {
		if errno == windows.ERROR_ACCESS_DENIED {
			// Almost always an elevated host and an unelevated us. Worth
			// naming: the same mismatch stops Explorer's double-click reaching
			// that host at all, so it is a problem beyond this upgrade.
			return fmt.Errorf(
				"a kunang host is running that this process is not allowed to talk to.\n\n" +
					"That usually means it was started as administrator. Close it from Task " +
					"Manager (kunang.exe) and run this again — and prefer to start kunang " +
					"without administrator rights, or double-clicking a .md cannot reach it.")
		}
		// Anything else: no pipe, so nothing resident to stop.
		return nil
	}

	_ = writePayload(h, Payload{Argv: []string{"--quit"}, T0: unixNano()})
	windows.CloseHandle(windows.Handle(h))

	deadline := time.Now().Add(15 * time.Second)
	for {
		if !waitForHost(0) {
			return nil
		}
		if !time.Now().Before(deadline) {
			return fmt.Errorf(
				"the running kunang host did not exit.\n\n" +
					"Close any kunang windows — an unsaved document will be waiting on a " +
					"prompt — and run this again.")
		}
		time.Sleep(200 * time.Millisecond)
	}
}

// bootstrap is the install-or-upgrade path of the single-file portable build:
// stop whatever is resident, extract, provision, start the new host and wait
// for it to answer. Runs where the installed build already matches skip
// straight to the fast pipe path — the whole point being that a .md open only
// ever runs the stub.
func bootstrap() error {
	app, err := appDir()
	if err != nil {
		return err
	}

	if err := quitResidentHost(); err != nil {
		return err
	}

	if err := installPayload(app); err != nil {
		return err
	}

	if err := provision(); err != nil {
		return err
	}

	return ensureHost()
}

// ensureHost makes the resident host available, starting it if it is not.
// Running the portable exe with no file is a request for exactly this — after
// a reboot there is nothing else the launch could mean.
func ensureHost() error {
	// A host may already be resident; connecting is cheaper than spawning a
	// second one that would only lose the pipe election and exit.
	if waitForHost(0) {
		return nil
	}

	if err := spawnPortableHost(); err != nil {
		return err
	}

	if !waitForHost(30 * time.Second) {
		return fmt.Errorf("host did not come up")
	}
	return nil
}
