package main

import (
	"fmt"
	"os"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	kernel32Replace         = windows.NewLazySystemDLL("kernel32.dll")
	procReplaceFileW        = kernel32Replace.NewProc("ReplaceFileW")
	procGetLastError        = kernel32Replace.NewProc("GetLastError")
)

const (
	REPLACEFILE_WRITE_THROUGH      = 0x00000001
	REPLACEFILE_IGNORE_MERGE_ERRORS = 0x00000002
	REPLACEFILE_IGNORE_ACL_ERRORS  = 0x00000004
)

func runReplace(replacementPath, replacedPath string) {
	rp, err := windows.UTF16PtrFromString(replacementPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "replace: invalid replacement path: %v\n", err)
		os.Exit(1)
	}
	dp, err := windows.UTF16PtrFromString(replacedPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "replace: invalid destination path: %v\n", err)
		os.Exit(1)
	}

	// No backup
	ret, _, _ := procReplaceFileW.Call(
		uintptr(unsafe.Pointer(dp)),
		uintptr(unsafe.Pointer(rp)),
		0, // lpBackupFileName
		REPLACEFILE_IGNORE_MERGE_ERRORS|REPLACEFILE_IGNORE_ACL_ERRORS,
		0, 0,
	)

	if ret == 0 {
		err = syscall.GetLastError()
		fmt.Fprintf(os.Stderr, "ReplaceFileW failed: %v\n", err)
		os.Exit(1)
	}
}
