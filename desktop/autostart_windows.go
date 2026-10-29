//go:build windows

package main

import (
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows/registry"
)

// Start with Windows is the per-user "Run" entry, the same place Task Manager's Startup tab shows.
const runKey = `Software\Microsoft\Windows\CurrentVersion\Run`

func exePath() (string, error) {
	p, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.EvalSymlinks(p)
}

func autostartEnabled(string) bool {
	k, err := registry.OpenKey(registry.CURRENT_USER, runKey, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer k.Close()
	v, _, err := k.GetStringValue("Cent-aur")
	exe, err2 := exePath()
	// an entry for a copy of Cent-aur somewhere else does not count: switching it on fixes the path
	return err == nil && err2 == nil && strings.EqualFold(strings.Trim(v, `"`), exe)
}

func setAutostart(_ string, on bool) error {
	k, err := registry.OpenKey(registry.CURRENT_USER, runKey, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	if !on {
		if err := k.DeleteValue("Cent-aur"); err != nil && err != registry.ErrNotExist {
			return err
		}
		return nil
	}
	exe, err := exePath()
	if err != nil {
		return err
	}
	return k.SetStringValue("Cent-aur", `"`+exe+`"`)
}
