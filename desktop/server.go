package main

import (
	"bytes"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// The same messages as the page and api.php use, so the page can translate them.
const (
	msgUnreachable = "The server could not be reached. Check the address and your connection."
	msgNotCentaur  = "That address answered, but it is not a Cent-aur server."
	msgBadAddress  = "Enter the server address, for example https://cent-aur.example.com"
	msgNotOffline  = "This is not available while working offline."
	msgFolderPath  = "Enter the full path of a folder, for example D:\\Cent-aur"
	msgFolderWrite = "Cent-aur cannot save files in that folder."
	msgFolderData  = "That folder already has Cent-aur data."
	msgFolderMove  = "Your data could not be moved there. Nothing was changed."
	maxBody        = 9 << 20
	locationFile   = "location.txt" // in the standard folder: the data folder chosen in Options
)

// pickFolder shows the Windows folder picker (set by app_windows.go; nil elsewhere) and returns the
// chosen folder, or "" when cancelled.
var pickFolder func(title string) string

// Config is what the app remembers between starts (settings.json).
type Config struct {
	Mode   string // "" (not chosen yet), "online" or "offline"
	Server string // the Cent-aur server, once signed in
	Cookie string // that server's sign-in (its ca_session cookie)
	Forget bool   // "Remember me" was off: the sign-in is kept in memory only and ends when the app closes
}

// configFile is Config as stored: the sign-in is encrypted for this Windows user (see protect_windows.go).
type configFile struct {
	Mode   string `json:"mode"`
	Server string `json:"server,omitempty"`
	Cookie string `json:"cookie,omitempty"`
	Forget bool   `json:"forget,omitempty"`
}

type App struct {
	base  string // the standard folder (%APPDATA%\Cent-aur): the window's cache, and location.txt
	host  string // 127.0.0.1:port, the only address the window uses
	token string // given to the window when it opens; nothing else on this PC has it
	files http.Handler
	http  *http.Client

	mu    sync.Mutex
	cfg   Config
	dir   string // the data folder: settings.json and the offline database (changed in Options)
	store *Store
}

func NewApp(base, dir string, web fs.FS) (*App, error) {
	key := make([]byte, 24)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	store, err := OpenStore(filepath.Join(dir, "cent-aur.db"))
	if err != nil {
		return nil, err
	}
	a := &App{
		base:  base,
		dir:   dir,
		token: base64.RawURLEncoding.EncodeToString(key),
		files: http.FileServer(http.FS(web)),
		store: store,
		http: &http.Client{
			Timeout:       90 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
	}
	a.load()
	return a, nil
}

func (a *App) load() {
	raw, err := os.ReadFile(filepath.Join(a.dir, "settings.json"))
	if err != nil {
		return
	}
	var f configFile
	if json.Unmarshal(raw, &f) != nil {
		return
	}
	a.cfg = Config{Mode: f.Mode, Server: f.Server, Forget: f.Forget}
	if b, err := base64.StdEncoding.DecodeString(f.Cookie); err == nil && len(b) > 0 {
		if plain, err := unprotect(b); err == nil {
			a.cfg.Cookie = string(plain)
		}
	}
}

func (a *App) config() Config {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.cfg
}

// folder and data return the data folder and the offline database, which Options can change at any time.
func (a *App) folder() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.dir
}

func (a *App) data() *Store {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.store
}

// update changes the remembered settings and writes them to disk.
func (a *App) update(change func(*Config)) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	change(&a.cfg)
	return a.save()
}

// save writes the settings to the data folder; a.mu is held.
func (a *App) save() error {
	f := configFile{Mode: a.cfg.Mode, Server: a.cfg.Server, Forget: a.cfg.Forget}
	if a.cfg.Cookie != "" && !a.cfg.Forget {
		enc, err := protect([]byte(a.cfg.Cookie))
		if err != nil {
			return err
		}
		f.Cookie = base64.StdEncoding.EncodeToString(enc)
	}
	raw, _ := json.MarshalIndent(f, "", "  ")
	tmp := filepath.Join(a.dir, "settings.json.tmp")
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(a.dir, "settings.json"))
}

func (a *App) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Other programs and web pages on this PC can reach the port too, so only this program's window
	// is served: it uses exactly this address (which rules out DNS tricks) and has the launch key.
	if r.Host != a.host {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}
	if t := r.URL.Query().Get("t"); r.URL.Path == "/" && t != "" {
		if subtle.ConstantTimeCompare([]byte(t), []byte(a.token)) != 1 {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		http.SetCookie(w, &http.Cookie{Name: "desk", Value: a.token, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode})
		http.Redirect(w, r, "/", http.StatusSeeOther)
		return
	}
	// The page, icons and manifest are public anyway (the browser even fetches the manifest without
	// cookies); the data behind /api/ needs the key.
	isAPI := strings.HasPrefix(r.URL.Path, "/api/")
	if c, err := r.Cookie("desk"); isAPI && (err != nil || subtle.ConstantTimeCompare([]byte(c.Value), []byte(a.token)) != 1) {
		http.Error(w, "Open Cent-aur from its own window.", http.StatusForbidden)
		return
	}
	h := w.Header()
	h.Set("X-Frame-Options", "DENY")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "same-origin")
	h.Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'")
	if isAPI {
		a.api(w, r, strings.TrimPrefix(r.URL.Path, "/api/"))
		return
	}
	h.Set("Cache-Control", "no-cache")
	a.files.ServeHTTP(w, r)
}

func (a *App) api(w http.ResponseWriter, r *http.Request, path string) {
	if r.Method != http.MethodGet && r.Header.Get("X-Requested-With") != "CentAur" {
		fail(w, http.StatusForbidden, "Blocked: missing header.")
		return
	}
	switch {
	case path == "session" && r.Method == http.MethodGet:
		a.session(w)
	case path == "login" && r.Method == http.MethodPost:
		a.login(w, r)
	case path == "offline" && r.Method == http.MethodPost:
		a.goOffline(w)
	case path == "logout" && r.Method == http.MethodPost:
		a.logout(w)
	case path == "desktop/autostart":
		a.autostart(w, r)
	case path == "desktop/folder" && r.Method == http.MethodPost:
		a.changeFolder(w, r)
	case path == "desktop/folder/pick" && r.Method == http.MethodPost:
		a.pick(w, r)
	default:
		switch a.config().Mode {
		case "offline":
			a.offline(w, r, path)
		case "online":
			a.proxy(w, r, path)
		default:
			fail(w, http.StatusUnauthorized, "Please sign in.")
		}
	}
}

// desktop tells the page it runs in the desktop app, and how.
func (a *App) desktop() map[string]any {
	cfg := a.config()
	server := cfg.Server
	if server == "" {
		server = defaultServer
	}
	dir := a.folder()
	return map[string]any{"mode": cfg.Mode, "server": server, "remember": !cfg.Forget, "autostart": autostartEnabled(dir),
		"folder": dir, "standard": samePath(dir, a.base), "picker": pickFolder != nil}
}

var offlineUser = map[string]any{"id": 0, "username": "This PC", "role": "user", "must_change": false, "version": version}

func (a *App) session(w http.ResponseWriter) {
	cfg := a.config()
	switch cfg.Mode {
	case "offline":
		send(w, http.StatusOK, map[string]any{"user": offlineUser, "desktop": a.desktop()})
	case "online":
		resp, err := a.remote(http.MethodGet, cfg.Server, "session", nil, cfg.Cookie)
		if err != nil {
			send(w, http.StatusBadGateway, map[string]any{"error": msgUnreachable, "desktop": a.desktop()})
			return
		}
		defer resp.Body.Close()
		var j map[string]any
		if json.NewDecoder(io.LimitReader(resp.Body, maxBody)).Decode(&j) != nil || resp.StatusCode != http.StatusOK {
			send(w, http.StatusBadGateway, map[string]any{"error": msgNotCentaur, "desktop": a.desktop()})
			return
		}
		j["desktop"] = a.desktop()
		send(w, http.StatusOK, j)
	default:
		send(w, http.StatusOK, map[string]any{"user": nil, "desktop": a.desktop()})
	}
}

// login signs in to a Cent-aur server; from then on the page's requests go there.
func (a *App) login(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Server, Username, Password string
		Remember                   *bool // missing = remember
	}
	if json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in) != nil {
		fail(w, http.StatusBadRequest, "Bad request.")
		return
	}
	server, ok := serverAddress(in.Server)
	if !ok {
		fail(w, http.StatusBadRequest, msgBadAddress)
		return
	}
	body, _ := json.Marshal(map[string]string{"username": in.Username, "password": in.Password})
	resp, err := a.remote(http.MethodPost, server, "login", body, "")
	if err != nil {
		fail(w, http.StatusBadGateway, msgUnreachable)
		return
	}
	defer resp.Body.Close()
	var j map[string]any
	if json.NewDecoder(io.LimitReader(resp.Body, maxBody)).Decode(&j) != nil {
		fail(w, http.StatusBadGateway, msgNotCentaur)
		return
	}
	if resp.StatusCode != http.StatusOK {
		send(w, resp.StatusCode, j) // wrong password, too many tries...: the server's own message
		return
	}
	cookie := ""
	for _, c := range resp.Cookies() {
		if c.Name == "ca_session" {
			cookie = c.Value
		}
	}
	if cookie == "" {
		fail(w, http.StatusBadGateway, msgNotCentaur)
		return
	}
	forget := in.Remember != nil && !*in.Remember
	if err := a.update(func(c *Config) { *c = Config{Mode: "online", Server: server, Cookie: cookie, Forget: forget} }); err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	j["desktop"] = a.desktop()
	send(w, http.StatusOK, j)
}

// Close runs when the app closes: a sign-in that is not remembered is also ended on the server.
// It waits at most a few seconds, so a slow server never keeps the program running.
func (a *App) Close() {
	cfg := a.config()
	if cfg.Mode != "online" || !cfg.Forget || cfg.Cookie == "" {
		return
	}
	done := make(chan struct{})
	go func() {
		if resp, err := a.remote(http.MethodPost, cfg.Server, "logout", []byte("{}"), cfg.Cookie); err == nil {
			resp.Body.Close()
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
	}
}

// serverAddress accepts "cent-aur.example.com", "https://cent-aur.example.com/" and the like.
func serverAddress(s string) (string, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", false
	}
	if !strings.Contains(s, "://") {
		s = "https://" + s
	}
	u, err := url.Parse(s)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return "", false
	}
	path := strings.TrimSuffix(strings.TrimSuffix(u.Path, "/"), "/api")
	return u.Scheme + "://" + u.Host + strings.TrimSuffix(path, "/"), true
}

func (a *App) goOffline(w http.ResponseWriter) {
	if err := a.update(func(c *Config) { c.Mode, c.Cookie = "offline", "" }); err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	send(w, http.StatusOK, map[string]any{"user": offlineUser, "desktop": a.desktop()})
}

// logout leaves the current mode (signs out of the server, or stops working offline) and goes back
// to the first screen. Offline data stays on this PC.
func (a *App) logout(w http.ResponseWriter) {
	cfg := a.config()
	if cfg.Mode == "online" && cfg.Cookie != "" {
		if resp, err := a.remote(http.MethodPost, cfg.Server, "logout", []byte("{}"), cfg.Cookie); err == nil {
			resp.Body.Close()
		}
	}
	if err := a.update(func(c *Config) { c.Mode, c.Cookie = "", "" }); err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	send(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *App) autostart(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		var in struct{ On bool }
		if json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&in) != nil {
			fail(w, http.StatusBadRequest, "Bad request.")
			return
		}
		if err := setAutostart(a.folder(), in.On); err != nil {
			fail(w, http.StatusInternalServerError, "Could not change the start-with-Windows setting.")
			return
		}
	}
	send(w, http.StatusOK, map[string]any{"on": autostartEnabled(a.folder())})
}

// ---------------------------------------------------------------- Options > Data folder

func (a *App) pick(w http.ResponseWriter, r *http.Request) {
	if pickFolder == nil {
		fail(w, http.StatusNotFound, "Not available.")
		return
	}
	var in struct{ Title string }
	json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&in)
	if in.Title == "" {
		in.Title = "Choose the folder for Cent-aur's data"
	}
	send(w, http.StatusOK, map[string]any{"folder": pickFolder(in.Title)})
}

// changeFolder moves the settings and the offline data to another folder ("" = back to the standard
// one) and uses it from then on. A folder that already has Cent-aur data is only used, never
// overwritten, and only when the page says so (use_existing): then the data here stays where it is.
func (a *App) changeFolder(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Folder      string `json:"folder"`
		UseExisting bool   `json:"use_existing"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 8192)).Decode(&in) != nil {
		fail(w, http.StatusBadRequest, "Bad request.")
		return
	}
	target := a.base
	if strings.TrimSpace(in.Folder) != "" {
		target = filepath.Clean(strings.TrimSpace(in.Folder))
	}
	if !filepath.IsAbs(target) {
		fail(w, http.StatusBadRequest, msgFolderPath)
		return
	}
	if code, msg := a.moveTo(target, in.UseExisting); code != http.StatusOK {
		send(w, code, map[string]any{"error": msg, "exists": msg == msgFolderData})
		return
	}
	send(w, http.StatusOK, map[string]any{"desktop": a.desktop()})
}

func (a *App) moveTo(target string, useExisting bool) (int, string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if samePath(target, a.dir) {
		return http.StatusOK, ""
	}
	if os.MkdirAll(target, 0o700) != nil {
		return http.StatusBadRequest, msgFolderWrite
	}
	probe, err := os.CreateTemp(target, ".cent-aur-*")
	if err != nil {
		return http.StatusBadRequest, msgFolderWrite
	}
	probe.Close()
	os.Remove(probe.Name())

	db := filepath.Join(target, "cent-aur.db")
	_, err = os.Stat(db)
	exists := err == nil
	if exists && !useExisting {
		return http.StatusConflict, msgFolderData
	}
	if !exists {
		// SQLite writes a complete, consistent copy of the open database
		if _, err := a.store.db.Exec(`VACUUM INTO ?`, db); err != nil {
			os.Remove(db)
			return http.StatusInternalServerError, msgFolderMove
		}
	}
	store, err := OpenStore(db)
	if err != nil {
		if !exists {
			os.Remove(db)
		}
		return http.StatusInternalServerError, msgFolderMove
	}
	old, oldStore := a.dir, a.store
	a.dir, a.store = target, store
	pointer := filepath.Join(a.base, locationFile)
	if samePath(target, a.base) {
		err = os.Remove(pointer)
		if os.IsNotExist(err) {
			err = nil
		}
	} else {
		err = os.WriteFile(pointer+".tmp", []byte(target+"\n"), 0o600)
		if err == nil {
			err = os.Rename(pointer+".tmp", pointer)
		}
	}
	if err == nil {
		err = a.save()
	}
	if err != nil { // back to the folder it was using
		a.dir, a.store = old, oldStore
		store.db.Close()
		if !exists {
			os.Remove(db)
		}
		return http.StatusInternalServerError, msgFolderMove
	}
	if raw, err := os.ReadFile(filepath.Join(old, "autostart")); err == nil { // Start with Windows on the test build
		os.WriteFile(filepath.Join(target, "autostart"), raw, 0o600)
	}
	oldStore.db.Close()
	if !exists { // moved: the copy left behind would only confuse
		for _, f := range []string{"cent-aur.db", "cent-aur.db-wal", "cent-aur.db-shm", "settings.json", "autostart"} {
			os.Remove(filepath.Join(old, f))
		}
	}
	return http.StatusOK, ""
}

// samePath compares folders the way the system does (Windows ignores upper and lower case).
func samePath(x, y string) bool {
	x, y = filepath.Clean(x), filepath.Clean(y)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(x, y)
	}
	return x == y
}

// ---------------------------------------------------------------- working offline: data on this PC

func (a *App) offline(w http.ResponseWriter, r *http.Request, path string) {
	if path != "data" {
		fail(w, http.StatusNotFound, msgNotOffline)
		return
	}
	if r.Method == http.MethodGet {
		have := -1
		if v := r.URL.Query().Get("rev"); v != "" {
			if err := json.Unmarshal([]byte(v), &have); err != nil {
				have = -1
			}
		}
		rev, data, err := a.data().Get()
		if err != nil {
			fail(w, http.StatusInternalServerError, "Something went wrong on this PC.")
			return
		}
		if have == rev {
			send(w, http.StatusOK, map[string]any{"rev": rev, "same": true})
			return
		}
		if data == nil {
			data = json.RawMessage("null")
		}
		send(w, http.StatusOK, map[string]any{"rev": rev, "data": data})
		return
	}
	if r.Method != http.MethodPut {
		fail(w, http.StatusMethodNotAllowed, "Not allowed.")
		return
	}
	var in struct {
		Rev  *int            `json:"rev"`
		Data json.RawMessage `json:"data"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, maxBody)).Decode(&in) != nil || in.Rev == nil || !isDocument(in.Data) {
		fail(w, http.StatusBadRequest, "Bad request.")
		return
	}
	rev, err := a.data().Put(*in.Rev, in.Data)
	var clash *Clash
	switch {
	case errors.As(err, &clash):
		send(w, http.StatusConflict, map[string]any{"error": "Your data was changed on another device.", "rev": clash.Rev})
	case err != nil:
		fail(w, http.StatusInternalServerError, "Something went wrong on this PC.")
	default:
		send(w, http.StatusOK, map[string]any{"rev": rev})
	}
}

// isDocument checks the page sent its data: a JSON object with an "items" list.
func isDocument(raw json.RawMessage) bool {
	var d map[string]json.RawMessage
	if json.Unmarshal(raw, &d) != nil {
		return false
	}
	items := bytes.TrimSpace(d["items"])
	return len(items) > 0 && items[0] == '['
}

// ---------------------------------------------------------------- signed in: everything goes to the server

func (a *App) remote(method, server, path string, body []byte, cookie string) (*http.Response, error) {
	req, err := http.NewRequest(method, server+"/api/"+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Requested-With", "CentAur")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Cent-aur desktop")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if cookie != "" {
		req.AddCookie(&http.Cookie{Name: "ca_session", Value: cookie})
	}
	return a.http.Do(req)
}

func (a *App) proxy(w http.ResponseWriter, r *http.Request, path string) {
	cfg := a.config()
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBody))
	if err != nil {
		fail(w, http.StatusBadRequest, "Bad request.")
		return
	}
	if r.URL.RawQuery != "" {
		path += "?" + r.URL.RawQuery
	}
	if r.Method == http.MethodGet {
		body = nil
	}
	resp, err := a.remote(r.Method, cfg.Server, path, body, cfg.Cookie)
	if err != nil {
		fail(w, http.StatusBadGateway, msgUnreachable)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		a.update(func(c *Config) { c.Cookie = "" }) // signed out on the server (password changed, account disabled...)
	}
	for _, k := range []string{"Content-Type", "Content-Disposition", "Content-Length"} {
		if v := resp.Header.Get(k); v != "" {
			w.Header().Set(k, v)
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// ---------------------------------------------------------------- answers

func send(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	enc.Encode(v)
}

func fail(w http.ResponseWriter, code int, msg string) {
	send(w, code, map[string]string{"error": msg})
}
