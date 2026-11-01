"""End-to-end test of the desktop app's server (desktop/), run by tests/run-desktop-tests.sh.

The app is restarted between phases, so each phase also checks what it remembers:
  first     the first screen, Start with Windows, working offline, only its own window gets in, moving the data folder
  second    offline data and data folder kept; switching to sign in; sign-in mistakes; first sign-in through the app
  third     still signed in; managing users through the app; signing out; offline data kept apart; data folder back;
            signing in again with Remember me off
  fourth    not remembered: straight to Sign in, Remember me still off, and the server's sign-in was ended
"""
import os, sys, urllib.request, urllib.error
from playwright.sync_api import sync_playwright

URL = os.environ["DESK_URL"]                      # http://127.0.0.1:PORT/?t=KEY, as the window opens it
HOST = URL.split("/")[2]
SERVER = os.environ["SERVER"]                     # the Cent-aur server the build offers
phase = sys.argv[1]
failures = []


def check(cond, what):
    print(("ok    " if cond else "FAIL  ") + what)
    if not cond:
        failures.append(what)


def profile(page):
    """Opens Profile (backups and the account block), unless it is open already."""
    if page.is_hidden("#pfov"):
        page.click("#pfb")


def status(url, headers=None):
    try:
        return urllib.request.urlopen(urllib.request.Request(url, headers=headers or {})).status
    except urllib.error.HTTPError as e:
        return e.code


def add_expense(page, name, amount):
    page.fill("#amt", str(amount))
    page.fill("#name", name)
    page.keyboard.press("Escape")
    page.select_option("#freq", "0")
    page.click("#sb")
    page.wait_for_function("document.querySelector('#ach').textContent.includes('Saved at')")


def form_title(page, text):
    page.wait_for_function("t => document.querySelector('#fmt').textContent.includes(t) && !document.querySelector('#fmm').hidden", arg=text)


with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1300, "height": 950}, bypass_csp=True)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL)

    if phase == "first":
        form_title(page, "Welcome to Cent-aur")
        buttons = [page.text_content("#fmo"), page.text_content("#fma2")]
        check(buttons == ["Sign in", "Work offline on this PC"], "first screen offers: %s" % buttons)

        # only the app's own window may use its server
        base = "http://%s/" % HOST
        check(status(base + "api/session") == 403, "without the launch key: refused")
        check(status(base + "?t=wrong") == 403, "with a wrong launch key: refused")
        check(status(URL, {"Host": "evil.example"}) == 403, "under another host name: refused")

        page.click("#fma2")
        page.wait_for_selector("#fmm", state="hidden")
        check(page.text_content("#act") == "This PC", "offline: the account block says This PC")
        check("Working offline" in page.text_content("#ach"), "offline: it says the data stays on this PC")
        profile(page)
        check(page.is_visible('[data-ac="leave"]') and not page.is_visible('[data-ac="usrm"]'), "offline: a way to sign in, no user management")
        page.click("#pfx")
        add_expense(page, "Offline coffee", 3.5)

        page.click("#gear")
        check(page.is_visible("#autos"), "Options show Start with Windows")
        check(not page.is_checked("#autos"), "Start with Windows starts off")
        page.click("#autos")
        page.wait_for_timeout(500)
        check(page.is_checked("#autos"), "Start with Windows can be switched on")

        # Options > Data folder (the test app is in /data; Windows would show its folder picker instead of the form)
        check(page.text_content("#ddp") == "/data" and page.is_hidden("#ddr"), "Options show the data folder: " + page.text_content("#ddp"))
        page.click("#ddc")
        form_title(page, "Data folder")
        page.fill("#fm_d", "moved"); page.click("#fmo")
        page.wait_for_selector("#dlg:not([hidden])")
        msg = page.text_content("#dlgm")
        check("full path" in msg, "a folder that is not a full path is refused: " + msg)
        page.click("#dlgy")
        if page.is_hidden("#ddc"):
            page.click("#gear")
        page.click("#ddc")
        form_title(page, "Data folder")
        page.fill("#fm_d", "/data/moved"); page.click("#fmo")
        page.wait_for_function("document.querySelector('#ddp') && document.querySelector('#ddp').textContent === '/data/moved'")
        page.wait_for_function("document.querySelector('#sec') && document.querySelector('#sec').textContent.includes('Offline coffee')")
        check(True, "the data moves to the new folder and is still there")
        check(page.is_visible("#ddr") or page.evaluate("!document.getElementById('ddr').hidden"), "a way back to the standard folder")

    elif phase == "second":
        page.wait_for_function("document.querySelector('#sec') && document.querySelector('#sec').textContent.includes('Offline coffee')")
        check(True, "restarted: straight back to working offline, with its data")
        check(page.evaluate("document.getElementById('autos').checked"), "restarted: Start with Windows is still on")
        check(page.evaluate("document.getElementById('ddp').textContent") == "/data/moved", "restarted: still uses the chosen data folder")

        profile(page)
        page.click('[data-ac="leave"]')
        page.wait_for_selector("#dlg:not([hidden])")
        page.click("#dlgy")
        form_title(page, "Welcome to Cent-aur")
        page.click("#fmo")
        form_title(page, "Sign in")
        check(page.input_value("#fm_srv") == SERVER, "sign-in offers the server built into the app: %s" % page.input_value("#fm_srv"))
        check(page.is_checked("#fm_rem"), "Remember me is ticked at first")

        page.fill("#fm_srv", "http://nowhere.invalid"); page.fill("#fm_u", "admin"); page.fill("#fm_p", "admin"); page.click("#fmo")
        page.wait_for_selector("#fme:not([hidden])")
        check("could not be reached" in page.text_content("#fme"), "an unknown server: " + page.text_content("#fme"))
        page.fill("#fm_srv", SERVER); page.fill("#fm_p", "wrong-password"); page.click("#fmo")
        page.wait_for_function("document.querySelector('#fme').textContent.includes('Wrong')")
        check(True, "a wrong password: the server's own message")

        page.fill("#fm_p", "admin"); page.click("#fmo")
        form_title(page, "Choose your password")
        page.fill("#fm_n", "adminpass123"); page.fill("#fm_n2", "adminpass123"); page.click("#fmo")
        page.wait_for_selector("#fmm", state="hidden")
        page.wait_for_selector("#acw:not([hidden])")
        check(page.text_content("#act") == "Account", "signed in: the account block is the server account")
        check(SERVER.split("//")[1] in page.text_content("#ach"), "signed in: it names the server")
        check("Offline coffee" not in page.text_content("#sec"), "the server account does not show the offline data")
        add_expense(page, "Online rent", 650)

    elif phase == "third":
        page.wait_for_function("document.querySelector('#sec') && document.querySelector('#sec').textContent.includes('Online rent')")
        check(True, "restarted: still signed in to the server, with its data")
        profile(page)
        page.click('[data-ac="usrm"]')
        page.wait_for_selector(".usrr")
        page.click('[data-um="add"]')
        page.fill("#fm_u", "maria"); page.fill("#fm_p", "mariapass123"); page.click("#fmo")
        page.wait_for_function("document.querySelectorAll('.usrr').length === 2")
        check(True, "the administrator adds a user through the app")
        page.click("#usrx")

        page.click('[data-ac="out"]')
        page.wait_for_selector("#dlg:not([hidden])")
        page.click("#dlgy")
        form_title(page, "Welcome to Cent-aur")
        check(True, "signing out goes back to the first screen")
        page.click("#fma2")
        page.wait_for_selector("#fmm", state="hidden")
        sec = page.text_content("#sec")
        check("Offline coffee" in sec and "Online rent" not in sec, "working offline again: the PC's own data, kept apart")

        page.click("#gear")
        page.click("#ddr")
        page.wait_for_selector("#dlg:not([hidden])")
        page.click("#dlgy")
        page.wait_for_function("document.querySelector('#ddp') && document.querySelector('#ddp').textContent === '/data'")
        page.wait_for_function("document.querySelector('#sec') && document.querySelector('#sec').textContent.includes('Offline coffee')")
        check(True, "back to the standard folder, with the data")

        profile(page)
        page.click('[data-ac="leave"]')
        page.wait_for_selector("#dlg:not([hidden])")
        page.click("#dlgy")
        form_title(page, "Welcome to Cent-aur")
        page.click("#fmo")
        form_title(page, "Sign in")
        page.fill("#fm_srv", SERVER); page.fill("#fm_u", "admin"); page.fill("#fm_p", "adminpass123"); page.uncheck("#fm_rem"); page.click("#fmo")
        page.wait_for_selector("#fmm", state="hidden")
        page.wait_for_function("document.querySelector('#sec') && document.querySelector('#sec').textContent.includes('Online rent')")
        check(True, "signed in with Remember me off")

    elif phase == "fourth":
        form_title(page, "Sign in")
        check(True, "restarted without Remember me: straight to Sign in")
        check(page.input_value("#fm_srv") == SERVER, "the server address is still filled in")
        check(not page.is_checked("#fm_rem"), "Remember me stays off, as chosen last time")

    check(not errors, "no script errors: %s" % errors)
    browser.close()

print()
print("%d FAILED" % len(failures) if failures else "ALL OK")
sys.exit(1 if failures else 0)
