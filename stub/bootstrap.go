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

// isProvisioned reports whether this version's payload is already on disk. The
// marker is written last, so a half-finished extraction never looks complete.
func isProvisioned() bool {
	dir, err := appDir()
	if err != nil {
		return false
	}
	_, err = os.Stat(filepath.Join(dir, ".complete"))
	return err == nil
}

func hostExe() (string, error) {
	dir, err := appDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "kunang.exe"), nil
}

// extractPayload unzips into a per-process temp directory and renames it into
// place. Rename is the commit point: two concurrent first runs both extract,
// but only one lands, and the loser discards its copy.
func extractPayload(dst string) error {
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

	if err := os.WriteFile(filepath.Join(tmp, ".complete"), []byte(version), 0o644); err != nil {
		return err
	}

	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}

	if err := os.Rename(tmp, dst); err != nil {
		// Another instance almost certainly won the race. Its copy is as good
		// as ours, so defer to it rather than fighting over the directory.
		if isProvisioned() {
			return nil
		}
		return err
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

// bootstrap is the first-run path of the single-file portable build: extract,
// provision, start the host, and wait for it to answer. Subsequent runs of the
// portable exe short-circuit on isProvisioned() and the fast pipe path takes
// over — the whole point being that later .md opens only ever run the stub.
func bootstrap() error {
	app, err := appDir()
	if err != nil {
		return err
	}

	if !isProvisioned() {
		if err := extractPayload(app); err != nil {
			return err
		}
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
