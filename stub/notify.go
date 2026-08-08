package main

import (
	"golang.org/x/sys/windows"
)

var (
	shell32            = windows.NewLazySystemDLL("shell32.dll")
	procSHChangeNotify = shell32.NewProc("SHChangeNotify")
)

const (
	shcneAssocChanged = 0x08000000
	// SHCNF_IDLIST is 0; SHCNF_FLUSH blocks until the notification is
	// delivered, which matters because this process exits immediately after.
	shcnfFlush = 0x1000
)

// notifyAssocChanged tells the shell to drop its cached file associations.
//
// Writing the HKCU class keys is not enough on its own: Explorer caches the
// extension -> ProgId mapping, so until this fires a freshly registered
// handler appears to do nothing on double-click — the keys are correct and
// the shell simply is not reading them. Like ReplaceFileW, this is a Win32
// call Node cannot make, so the stub carries it.
func notifyAssocChanged() {
	procSHChangeNotify.Call(shcneAssocChanged, shcnfFlush, 0, 0)
}
