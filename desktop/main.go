// Command cent-aur is the Cent-aur desktop app for Windows: a window showing the Cent-aur page,
// served by a small web server inside the program.
//
// Signed in, that server passes the page's requests on to your Cent-aur server, so you work with
// your online account. Working offline, it answers them itself from a SQLite file on this PC.
// See server.go for the requests, store.go for the offline data and app_windows.go for the window.
package main

import (
	"embed"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// The page itself: a copy of public/ made by build.sh.
//
//go:embed web
var webFiles embed.FS

// defaultServer is the address offered on the sign-in form. It is set when building:
//
//	go build -ldflags "-X main.defaultServer=https://cent-aur.example.com"
var defaultServer = ""

// dataDir returns the app's standard folder, %APPDATA%\Cent-aur on Windows (CENTAUR_DIR overrides it,
// for the tests), and the folder holding the settings and the offline database. That is the standard
// folder too, unless another one was chosen in Options: then location.txt in the standard folder names it.
func dataDir() (base, dir string, err error) {
	base = os.Getenv("CENTAUR_DIR")
	if base == "" {
		cfg, err := os.UserConfigDir()
		if err != nil {
			return "", "", err
		}
		base = filepath.Join(cfg, "Cent-aur")
	}
	if err := os.MkdirAll(base, 0o700); err != nil {
		return "", "", err
	}
	dir = base
	if raw, err := os.ReadFile(filepath.Join(base, locationFile)); err == nil && strings.TrimSpace(string(raw)) != "" {
		dir = strings.TrimSpace(string(raw))
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return "", "", fmt.Errorf("the data folder %s cannot be reached (%v).\n\nConnect the drive it is on and start Cent-aur again. "+
				"To use the standard folder instead, delete %s", dir, err, filepath.Join(base, locationFile))
		}
	}
	return base, dir, nil
}

// start runs the app's own server on a free port of this PC only, and returns the address the
// window opens, and the app (to Close when the window closes). CENTAUR_PORT fixes the port (used by the tests).
func start(base, dir string) (string, *App, error) {
	web, err := fs.Sub(webFiles, "web")
	if err != nil {
		return "", nil, err
	}
	app, err := NewApp(base, dir, web)
	if err != nil {
		return "", nil, err
	}
	port := os.Getenv("CENTAUR_PORT")
	if port == "" {
		port = "0"
	}
	ln, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		return "", nil, err
	}
	app.host = ln.Addr().String()
	go http.Serve(ln, app)
	return "http://" + app.host + "/?t=" + app.token, app, nil
}
