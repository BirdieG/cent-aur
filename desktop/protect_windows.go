//go:build windows

package main

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

// The server sign-in kept in settings.json is encrypted with Windows' own data protection, so it
// can only be read back by this Windows user on this PC.

func protect(b []byte) ([]byte, error) {
	return dpapi(b, func(in, out *windows.DataBlob) error {
		return windows.CryptProtectData(in, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, out)
	})
}

func unprotect(b []byte) ([]byte, error) {
	return dpapi(b, func(in, out *windows.DataBlob) error {
		return windows.CryptUnprotectData(in, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, out)
	})
}

func dpapi(b []byte, call func(in, out *windows.DataBlob) error) ([]byte, error) {
	if len(b) == 0 {
		return nil, nil
	}
	in := windows.DataBlob{Size: uint32(len(b)), Data: &b[0]}
	var out windows.DataBlob
	if err := call(&in, &out); err != nil {
		return nil, err
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
	return append([]byte(nil), unsafe.Slice(out.Data, out.Size)...), nil
}
