//go:build !windows

package main

// On other systems the app runs without a window, for development and the tests
// (tests/run-desktop-tests.sh): it prints the address to open in a browser.
// Start with Windows is a file in the data folder, and the sign-in is stored as it is.

import (
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
)

func main() {
	base, dir, err := dataDir()
	if err != nil {
		log.Fatal(err)
	}
	address, app, err := start(base, dir)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(address)
	// stopping the program (Ctrl+C, docker stop) is closing the window
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	app.Close()
}

func autostartEnabled(dir string) bool {
	_, err := os.Stat(filepath.Join(dir, "autostart"))
	return err == nil
}

func setAutostart(dir string, on bool) error {
	f := filepath.Join(dir, "autostart")
	if !on {
		if err := os.Remove(f); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	return os.WriteFile(f, nil, 0o600)
}

func protect(b []byte) ([]byte, error)   { return b, nil }
func unprotect(b []byte) ([]byte, error) { return b, nil }
