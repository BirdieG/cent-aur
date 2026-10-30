//go:build windows

package main

import (
	"path/filepath"
	"strings"
	"unsafe"

	"github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
)

var (
	user32         = windows.NewLazySystemDLL("user32.dll")
	findWindow     = user32.NewProc("FindWindowW")
	showWindow     = user32.NewProc("ShowWindow")
	setForeground  = user32.NewProc("SetForegroundWindow")
	messageBox     = user32.NewProc("MessageBoxW")
	dwmapi         = windows.NewLazySystemDLL("dwmapi.dll")
	dwmSetAttr     = dwmapi.NewProc("DwmSetWindowAttribute")
	shell32        = windows.NewLazySystemDLL("shell32.dll")
	browseFolder   = shell32.NewProc("SHBrowseForFolderW")
	pathFromIDList = shell32.NewProc("SHGetPathFromIDListW")
	ole32          = windows.NewLazySystemDLL("ole32.dll")
	oleInitialize  = ole32.NewProc("OleInitialize")
	coTaskMemFree  = ole32.NewProc("CoTaskMemFree")
	windowClass, _ = windows.UTF16PtrFromString("webview") // the class go-webview2 registers
	windowTitle, _ = windows.UTF16PtrFromString("Cent-aur")
	mutexName, _   = windows.UTF16PtrFromString(`Local\Cent-aur`)
)

func main() {
	// One Cent-aur at a time: starting it again brings the open window to the front.
	if _, err := windows.CreateMutex(nil, false, mutexName); err == windows.ERROR_ALREADY_EXISTS {
		if hwnd, _, _ := findWindow.Call(uintptr(unsafe.Pointer(windowClass)), uintptr(unsafe.Pointer(windowTitle))); hwnd != 0 {
			showWindow.Call(hwnd, 9) // SW_RESTORE
			setForeground.Call(hwnd)
		}
		return
	}
	base, dir, err := dataDir()
	if err != nil {
		alert("Cent-aur cannot open its folder:\n\n" + err.Error())
		return
	}
	address, app, err := start(base, dir)
	if err != nil {
		alert("Cent-aur cannot start:\n\n" + err.Error())
		return
	}
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		AutoFocus: true,
		DataPath:  filepath.Join(base, "WebView2"), // the window's own cache stays in the standard folder, wherever the data is
		WindowOptions: webview2.WindowOptions{
			Title: "Cent-aur", Width: 1280, Height: 860, Center: true,
			IconId: 1, // the icon build.sh puts into the program
		},
	})
	if w == nil {
		alert("Cent-aur needs Microsoft Edge WebView2, which is part of Windows 10 and 11.\n\n" +
			"Install the \"Evergreen\" runtime from https://developer.microsoft.com/microsoft-edge/webview2/ and start Cent-aur again.")
		return
	}
	defer w.Destroy()
	// the page calls this whenever its theme changes, so the title bar matches it
	hwnd := uintptr(w.Window())
	if err := w.Bind("ceTitleBar", func(bg, text int, dark bool) { titleBar(hwnd, uint32(bg), uint32(text), dark) }); err != nil {
		alert("Cent-aur cannot start:\n\n" + err.Error())
		return
	}
	// links to other websites (Cent-aur on GitHub) open in the PC's own browser, not in a second app window
	if err := w.Bind("ceOpen", func(link string) {
		if strings.HasPrefix(link, "https://") {
			windows.ShellExecute(0, windows.StringToUTF16Ptr("open"), windows.StringToUTF16Ptr(link), nil, nil, 1) // SW_SHOWNORMAL
		}
	}); err != nil {
		alert("Cent-aur cannot start:\n\n" + err.Error())
		return
	}
	// Options > Data folder > Change: the Windows folder picker, shown by the window's own thread
	pickFolder = func(title string) string {
		got := make(chan string, 1)
		w.Dispatch(func() { got <- chooseFolder(hwnd, title) })
		return <-got
	}
	w.Navigate(address)
	w.Run()
	app.Close()
}

// titleBar colours the window's title bar: dark or light on Windows 10, the exact colours on Windows 11
// (Windows 10 does not know the colour settings and ignores them). Colours are 0x00BBGGRR.
func titleBar(hwnd uintptr, bg, text uint32, dark bool) {
	d := uint32(0)
	if dark {
		d = 1
	}
	dwmSetAttr.Call(hwnd, 20, uintptr(unsafe.Pointer(&d)), 4)    // DWMWA_USE_IMMERSIVE_DARK_MODE
	dwmSetAttr.Call(hwnd, 35, uintptr(unsafe.Pointer(&bg)), 4)   // DWMWA_CAPTION_COLOR
	dwmSetAttr.Call(hwnd, 36, uintptr(unsafe.Pointer(&text)), 4) // DWMWA_TEXT_COLOR
}

// browseInfo is Windows' BROWSEINFOW.
type browseInfo struct {
	owner       uintptr
	root        uintptr
	displayName *uint16
	title       *uint16
	flags       uint32
	callback    uintptr
	param       uintptr
	image       int32
}

// chooseFolder shows the Windows folder picker and returns the chosen folder ("" when cancelled).
func chooseFolder(owner uintptr, title string) string {
	oleInitialize.Call(0) // the newer picker (with "Make New Folder") needs OLE on this thread
	name := make([]uint16, windows.MAX_PATH)
	t, _ := windows.UTF16PtrFromString(title)
	bi := browseInfo{owner: owner, displayName: &name[0], title: t, flags: 0x1 | 0x40} // BIF_RETURNONLYFSDIRS | BIF_NEWDIALOGSTYLE
	list, _, _ := browseFolder.Call(uintptr(unsafe.Pointer(&bi)))
	if list == 0 {
		return ""
	}
	defer coTaskMemFree.Call(list)
	path := make([]uint16, windows.MAX_PATH)
	if ok, _, _ := pathFromIDList.Call(list, uintptr(unsafe.Pointer(&path[0]))); ok == 0 {
		return ""
	}
	return windows.UTF16ToString(path)
}

func alert(text string) {
	t, _ := windows.UTF16PtrFromString(text)
	messageBox.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(windowTitle)), 0x10) // MB_ICONERROR
}
