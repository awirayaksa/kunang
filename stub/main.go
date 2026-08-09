package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	kernel32                         = windows.NewLazySystemDLL("kernel32.dll")
	procCreateFileW                  = kernel32.NewProc("CreateFileW")
	procGetNamedPipeServerProcessId  = kernel32.NewProc("GetNamedPipeServerProcessId")
	user32                           = windows.NewLazySystemDLL("user32.dll")
	procAllowSetForegroundWindow     = user32.NewProc("AllowSetForegroundWindow")
)

const (
	GENERIC_READ  = 0x80000000
	GENERIC_WRITE = 0x40000000
	OPEN_EXISTING = 3
	FILE_FLAG_OVERLAPPED = 0x40000000
	INVALID_HANDLE_VALUE = ^uintptr(0)
)

type Payload struct {
	Argv []string `json:"argv"`
	Cwd  string   `json:"cwd"`
	T0   int64    `json:"t0"`
}

func getPipeSecret() (string, error) {
	dir, err := dataDir()
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(filepath.Join(dir, "pipe"))
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// resolveHostPath finds the resident host executable. The stub cannot assume
// kunang.exe is its sibling: once registered as the .md handler it lives in
// %LOCALAPPDATA%\kunang while the host sits under app\<version>\. The host
// writes a pointer file on every start; the sibling lookup remains the
// fallback for the NSIS-installed layout.
func resolveHostPath() string {
	if dir, err := dataDir(); err == nil {
		if data, err := os.ReadFile(filepath.Join(dir, "host")); err == nil {
			path := strings.TrimSpace(string(data))
			if path != "" {
				if _, err := os.Stat(path); err == nil {
					return path
				}
			}
		}
	}

	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	return filepath.Join(filepath.Dir(exe), "kunang.exe")
}

func spawnHost() {
	hostPath := resolveHostPath()
	if hostPath == "" {
		return
	}
	cmd := exec.Command(hostPath, "--preload")
	cmd.Dir = filepath.Dir(hostPath)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP,
	}
	_ = cmd.Start()
}

// connectPipeRaw reports why the connect failed, not just that it did.
// "No host is running" and "a host is running that we may not talk to" call for
// completely different advice, and only the errno tells them apart.
func connectPipeRaw(secret string) (uintptr, windows.Errno) {
	pipeName := fmt.Sprintf(`\\.\pipe\kunang.%s`, secret)
	namePtr, err := windows.UTF16PtrFromString(pipeName)
	if err != nil {
		return INVALID_HANDLE_VALUE, windows.ERROR_INVALID_NAME
	}

	h, _, callErr := procCreateFileW.Call(
		uintptr(unsafe.Pointer(namePtr)),
		GENERIC_READ|GENERIC_WRITE,
		0, 0, OPEN_EXISTING, FILE_FLAG_OVERLAPPED, 0,
	)

	if h == INVALID_HANDLE_VALUE {
		if errno, ok := callErr.(syscall.Errno); ok {
			return h, windows.Errno(errno)
		}
		return h, windows.ERROR_FILE_NOT_FOUND
	}

	return h, 0
}

func connectPipe(secret string) (uintptr, error) {
	h, errno := connectPipeRaw(secret)
	if h == INVALID_HANDLE_VALUE {
		return 0, fmt.Errorf(`connect failed: \\.\pipe\kunang.%s: %w`, secret, errno)
	}
	return h, nil
}

func grantForeground(hPipe uintptr) {
	var hostPid uint32
	procGetNamedPipeServerProcessId.Call(hPipe, uintptr(unsafe.Pointer(&hostPid)))
	procAllowSetForegroundWindow.Call(uintptr(hostPid))
}

func writePayload(hPipe uintptr, payload Payload) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	// Write length prefix (4 bytes, little-endian) + data
	length := uint32(len(data))
	lenBytes := (*[4]byte)(unsafe.Pointer(&length))[:]

	var written uint32
	err = windows.WriteFile(windows.Handle(hPipe), lenBytes, &written, nil)
	if err != nil {
		return err
	}

	err = windows.WriteFile(windows.Handle(hPipe), data, &written, nil)
	return err
}

func unixNano() int64 {
	var ft windows.Filetime
	windows.GetSystemTimePreciseAsFileTime(&ft)
	return ft.Nanoseconds()
}

func main() {
	// Stamped first thing, before any other work. This is the number the host
	// measures against, so it has to represent the moment the handler was
	// entered — taking it later would quietly exclude the stub's own startup
	// from every measurement.
	t0 := unixNano()

	// Check if invoked as replace helper
	if len(os.Args) >= 3 && os.Args[1] == "--replace" {
		runReplace(os.Args[2], os.Args[3])
		return
	}

	// Invoked by the host right after it writes the association keys.
	if len(os.Args) >= 2 && os.Args[1] == "--notify-assoc" {
		notifyAssocChanged()
		return
	}

	// Portable single-file build: unpack ourselves and bring the host up before
	// doing anything else, on first run and on any run carrying a different
	// build than the one installed. Once the installed build matches this is a
	// single file read, and the registered handler is the payload-free stub,
	// which skips it entirely — so a .md open never pays this cost.
	if hasPayload {
		if !isCurrentBuild() {
			if err := bootstrap(); err != nil {
				// Built with -H=windowsgui, so there is no console to print to
				// and first-run failure would otherwise be entirely silent.
				showError("kunang could not start:\n\n" + err.Error())
				os.Exit(1)
			}
		} else if len(os.Args) < 2 {
			// Already unpacked and launched with no file: the user is asking
			// for the host to be running. With a file, the pipe path below
			// self-heals on its own.
			if err := ensureHost(); err != nil {
				showError("kunang could not start:\n\n" + err.Error())
				os.Exit(1)
			}
		}
	}

	// If no file argument, nothing to do
	if len(os.Args) < 2 {
		return
	}

	// Get cwd
	cwd, _ := os.Getwd()

	payload := Payload{
		Argv: os.Args[1:],
		Cwd:  cwd,
		T0:   t0,
	}

	// Try to connect to host
	secret, err := getPipeSecret()
	if err != nil {
		// Host probably not running; spawn and retry
		spawnHost()
		for i := 0; i < 50; i++ {
			time.Sleep(100 * time.Millisecond)
			secret, err = getPipeSecret()
			if err == nil {
				break
			}
		}
		if err != nil {
			os.Exit(1)
		}
	}

	h, err := connectPipe(secret)
	if err != nil {
		spawnHost()
		for i := 0; i < 50; i++ {
			time.Sleep(100 * time.Millisecond)
			h, err = connectPipe(secret)
			if err == nil {
				break
			}
		}
		if err != nil {
			os.Exit(1)
		}
	}
	defer windows.CloseHandle(windows.Handle(h))

	grantForeground(h)
	_ = writePayload(h, payload)
}
