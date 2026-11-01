"""End-to-end test of Cent-aur against a fresh server: run it with tests/run-tests.sh.

Covers the first sign-in with admin/admin, saving, two devices, edits clashing between devices,
losing the connection, managing users, the backup download and signing out.
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:8080").rstrip("/") + "/"
failures = []


def check(cond, what):
    print(("ok    " if cond else "FAIL  ") + what)
    if not cond:
        failures.append(what)


def profile(page):
    """Opens Profile (backups and the account block), unless it is open already."""
    if page.is_hidden("#pfov"):
        page.click("#pfb")


def data_of(page):
    return page.evaluate("fetch('/api/data',{cache:'no-store'}).then(r=>r.json())")


def names(page):
    d = data_of(page).get("data") or {}
    return [i["name"] for i in d.get("items", [])]


def add_expense(page, name, amount):
    page.fill("#amt", str(amount))
    page.fill("#name", name)
    page.select_option("#freq", "0")
    # waits for this save itself: "Saved at" may already show from an earlier one
    with page.expect_response(lambda r: "/api/data" in r.url and r.request.method == "PUT" and r.ok):
        page.click("#sb")
    page.wait_for_function("document.querySelector('#ach').textContent.includes('Saved at')")


def sign_in(page, user, pw):
    page.goto(BASE)
    page.wait_for_selector("#fmm:not([hidden])")
    page.fill("#fm_u", user)
    page.fill("#fm_p", pw)
    page.click("#fmo")


def come_back(page):
    """What happens when someone switches back to the tab: it checks for changes from other devices."""
    page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
    page.wait_for_timeout(800)


with sync_playwright() as pw:
    browser = pw.chromium.launch()
    errors = []

    def device(width=1300):
        # bypass_csp: the site's security policy forbids evaluating text as code, which is how the test inspects pages
        ctx = browser.new_context(viewport={"width": width, "height": 950}, accept_downloads=True, bypass_csp=True)
        p = ctx.new_page()
        p.on("pageerror", lambda e: errors.append(str(e)))
        p.on("dialog", lambda d: d.accept())
        return ctx, p

    # ---- while the page is asking the server who is signed in, only the logo shows, never the page behind it
    S_ctx, S = device()
    held = []   # the answer is held back until the check below is done
    S.route("**/api/session*", lambda route: held.append(route))
    # notes every layout shift (Lighthouse's CLS) from the very start of the page
    S.add_init_script("window.__ls=0;new PerformanceObserver(l=>{for(const e of l.getEntries())window.__ls+=e.value}).observe({type:'layout-shift',buffered:true})")
    S.goto(BASE, wait_until="domcontentloaded")
    while not held:
        S.wait_for_timeout(50)
    covered = S.evaluate("""(() => { const m = document.getElementById('fmm'), r = m.getBoundingClientRect();
        return !m.hidden && m.classList.contains('boot') && r.width >= innerWidth && r.height >= innerHeight
            && getComputedStyle(m).backgroundColor !== 'rgba(0, 0, 0, 0)' && !document.querySelector('#fmf').offsetParent })()""")
    check(covered, "while starting, a full cover with the logo hides the page")
    held[0].continue_()
    S.wait_for_selector("#fmf", state="visible")
    check("Sign in" in S.text_content("#fmt"), "then the sign-in form takes its place")
    gh = "https://github.com/BirdieG/cent-aur"
    check(S.is_visible('#fmm .ghl a[href="%s"]' % gh), "the sign-in screen links to the code on GitHub")
    check(S.evaluate("getComputedStyle(document.documentElement).overflowY") == "hidden", "the page behind the sign-in screen cannot scroll (no scrollbar)")
    S.wait_for_timeout(500)
    ls = S.evaluate("window.__ls")
    check(ls == 0, "nothing moves while the sign-in screen loads (layout shift %s)" % ls)
    check(S.evaluate("getComputedStyle(document.querySelector('main')).visibility") == "hidden", "the page behind the sign-in screen is hidden, also from screen readers")
    S_ctx.close()

    # ---- first start: admin/admin, then a new password is required
    A_ctx, A = device()
    sign_in(A, "admin", "wrong-password")
    A.wait_for_selector("#fme:not([hidden])")
    check("Wrong" in A.text_content("#fme"), "wrong password is refused")
    A.fill("#fm_p", "admin")
    A.click("#fmo")
    A.wait_for_function("document.querySelector('#fmt').textContent.includes('Choose your password')")
    check(True, "default admin/admin signs in and is asked for a new password")
    blocked = A.evaluate("fetch('/api/data').then(r=>r.status)")
    check(blocked == 403, "no data access before the new password is chosen (%s)" % blocked)
    A.fill("#fm_n", "admin")
    A.fill("#fm_n2", "admin")
    A.click("#fmo")
    A.wait_for_selector("#fme:not([hidden])")
    check(A.is_visible("#fme"), "'admin' is not accepted as the new password")
    A.fill("#fm_n", "adminpass123")
    A.fill("#fm_n2", "adminpass123")
    A.click("#fmo")
    A.wait_for_selector("#fmm", state="hidden")
    A.wait_for_selector("#acw:not([hidden])", state="attached")
    check("admin" in A.text_content("#ach"), "account block shows the admin")
    check(A.get_attribute('.appf a', "href") == gh and A.get_attribute('.appf a', "target") == "_blank", "the bottom of the app links to the code on GitHub, in a new tab")

    # ---- foldable cards: the heading stays a heading, with a real button inside it (keyboard works once per key press)
    check(A.evaluate("document.querySelectorAll('h2[role]').length") == 0, "no heading pretends to be a button")
    fb = '.slot[data-card="savings"] .head h2 > button.foldb'
    check(A.get_attribute(fb, "aria-expanded") == "true", "the Savings card's heading button says it is open")
    A.focus(fb)
    A.keyboard.press("Enter")
    shut = A.evaluate("""document.querySelector('.slot[data-card="savings"] .card').classList.contains('shut')""")
    check(shut and A.get_attribute(fb, "aria-expanded") == "false", "Enter on the heading button folds the card")
    A.keyboard.press("Enter")
    check(A.get_attribute(fb, "aria-expanded") == "true", "Enter again opens it")

    # ---- in the desktop app the page hands its theme colours to the window's title bar
    W = A.context.new_page()
    W.add_init_script("window.__tb=[];window.ceTitleBar=function(bg,fg,dark){window.__tb.push([bg,fg,dark]);return Promise.resolve()}")
    W.goto(BASE)
    W.wait_for_selector("#acw:not([hidden])", state="attached")
    W.emulate_media(color_scheme="dark")   # theme "auto" follows Windows; changing the theme setting itself would save and clash with A
    W.wait_for_function("__tb.length && __tb[__tb.length - 1][2] === true")
    tb = W.evaluate("""(() => { const l = __tb[__tb.length - 1], m = getComputedStyle(document.body).backgroundColor.match(/\\d+/g).map(Number);
        return { last: l, bg: m[0] | m[1] << 8 | m[2] << 16 } })()""")
    check(tb["last"][2] is True and tb["last"][0] == tb["bg"], "dark theme: the title bar gets the page's dark background %s" % tb)
    W.close()

    # ---- a frame added after the page's script (like Cloudflare's bot check) is given a title
    F = A.context.new_page()
    def add_frame(route):
        res = route.fetch()
        route.fulfill(response=res, body=res.text().replace("</body>", "<script>document.body.appendChild(document.createElement('iframe'))</script></body>"))
    F.route(BASE, add_frame)
    F.goto(BASE)
    F.wait_for_selector("#acw:not([hidden])", state="attached")
    check(F.evaluate("[...document.querySelectorAll('iframe')].every(f => f.title)"), "frames on the page have a title")
    F.close()

    # ---- saving goes to the server and survives a reload
    add_expense(A, "Rent test", 500)
    check("Rent test" in names(A), "expense is saved on the server")
    calls = []
    A.on("request", lambda r: "/api/" in r.url and calls.append(r.url.split("/api/")[1]))
    A.reload()
    A.wait_for_function("document.querySelector('#sec') && document.querySelector('#sec').textContent.includes('Rent test')")
    check(calls == ["session?data=1"], "opening the page asks the server once, for the session and the data together (%s)" % calls)
    check(True, "expense is still there after reloading the page")
    check(A.is_hidden("#fmm"), "signed in: the starting cover lifts once the data is on screen")
    check(A.evaluate("getComputedStyle(document.documentElement).overflowY") != "hidden", "signed in: the page scrolls again")
    check(A.evaluate("localStorage.getItem('expense-calc-v2')") is None, "nothing is kept in the browser's storage")

    # wide window, three columns: scrolling the page keeps the side columns' cards on screen
    # (partway down: at the very bottom a fixed column is pushed up by the end of the page, the left one too)
    stays = A.evaluate("""(async () => { const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const c = document.getElementById('colR'), at = () => { const r = c.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)] };
        scrollTo(0, 600); await frame(); const a = at();
        scrollBy(0, 300); await frame(); const b = at();
        scrollTo(0, 0); await frame(); return { a, b, vh: innerHeight } })()""")
    held = stays["a"] == stays["b"] and (stays["a"][0] == 16 or stays["a"][1] == stays["vh"] - 16)
    check(held, "scrolling down, the right column (Categories & bills, Insights, What if) is held in place: at its top, or at its end when taller than the window (%s)" % stays)

    # ---- a side column taller than the window has no scrollbar of its own: it moves with the page until its end shows
    vp = A.viewport_size
    A.set_viewport_size({"width": vp["width"], "height": 420})
    tall = A.evaluate("""(async () => { const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const c = document.getElementById('colL'), own = c.scrollHeight > c.clientHeight + 1 && getComputedStyle(c).overflowY !== 'visible';
        scrollTo(0, document.documentElement.scrollHeight); await frame();
        const end = Math.round(c.getBoundingClientRect().bottom);
        scrollBy(0, -150); await frame();
        const up = Math.round(c.getBoundingClientRect().bottom);
        scrollTo(0, 0); await frame();
        return { own, h: c.offsetHeight, end, up, vh: innerHeight } })()""")
    check(not tall["own"] and tall["h"] > tall["vh"], "the left column has no scrollbar of its own (%s)" % tall)
    check(tall["end"] <= tall["vh"], "scrolled to the bottom, the end of the left column is on screen")
    check(tall["up"] > tall["end"], "scrolling back up, the left column moves with the page")
    A.set_viewport_size(vp)

    # ---- a second device of the same person
    B_ctx, B = device(390)
    sign_in(B, "admin", "adminpass123")
    B.wait_for_selector("#fmm", state="hidden")
    B.wait_for_function("document.querySelector('#sec').textContent.includes('Rent test')")
    check(True, "second device (phone size) shows the same data")
    add_expense(B, "Coffee B", 3.5)
    come_back(A)
    check("Coffee B" in A.text_content("#sec"), "first device picks up the second device's change")

    # ---- both devices change the data at the same time: the later save is told and reloaded
    add_expense(B, "From B", 7)
    A.fill("#amt", "9"); A.fill("#name", "Lost on A"); A.select_option("#freq", "0")
    seen = []
    A.once("dialog", lambda d: seen.append(d.message))
    A.click("#sb")
    A.wait_for_selector("#dlg:not([hidden])")
    msg = A.text_content("#dlgm")
    check("another device" in msg, "clashing change is reported: " + msg[:60])
    A.click("#dlgy")
    sec = A.text_content("#sec")
    check("From B" in sec and "Lost on A" not in sec, "after the clash the first device shows the latest data")

    # ---- the connection drops on the phone
    B_ctx.set_offline(True)
    B.fill("#amt", "4"); B.fill("#name", "Offline thing"); B.select_option("#freq", "0"); B.click("#sb")
    B.wait_for_selector("#netbar:not([hidden])")
    check("Cannot reach the server" in B.text_content("#netbar"), "a bar says the change is not saved yet")
    B_ctx.set_offline(False)
    B.evaluate("window.dispatchEvent(new Event('online'))")
    B.wait_for_selector("#netbar", state="hidden")
    check("Offline thing" in names(A), "the change is saved once the connection is back")

    # ---- administrator: users and backup
    check(A.text_content("#gear").strip() == "Settings", "the settings button says Settings")
    profile(A)
    check(A.is_visible("#pfov #ex") and A.is_visible("#pfov #acw"), "Profile shows the backups and the account")
    check(A.query_selector('.slot[data-card="data"]') is None, "Your data is no longer a card on the page")
    check(A.is_visible("#pfov #inc") and A.query_selector('.slot[data-card="budget"]') is None, "the budget is set in Profile, not in a card")
    A.click('[data-ac="usrm"]')
    A.wait_for_selector(".usrr")
    # ad blockers hide elements named like adverts (EasyList has "###adtop") on every site, so avoid such names
    adlike = A.evaluate("""[...document.querySelectorAll('*')].flatMap(e => [e.id, ...e.classList])
        .filter(n => /^(ad|ads|advert|banner|sponsor)([-_]|top|bottom|box|bar|wrap|slot|unit|block)?$|^ad[-_]?(top|banner|box|slot)/i.test(n))""")
    check(adlike == [], "no element names that ad blockers hide: %s" % adlike)
    visible = A.evaluate("[...document.querySelectorAll('#usrtop button')].every(b => b.offsetWidth > 0 && b.offsetHeight > 0)")
    check(visible, "the Manage users buttons are actually visible")
    top = [b.text_content() for b in A.query_selector_all("#usrtop button")]
    check(top == ["+ Add user", "Download backup"], "Manage users shows: %s" % top)
    with A.expect_download() as dl:
        A.click('[data-um="bak"]')
    path = dl.value.path()
    check(open(path, "rb").read(16) == b"SQLite format 3\x00", "backup download is an SQLite database")
    A.click('[data-um="add"]')
    A.fill("#fm_u", "maria"); A.fill("#fm_p", "mariapass123"); A.click("#fmo")
    A.wait_for_selector("#fmm", state="hidden")
    A.wait_for_function("document.querySelectorAll('.usrr').length === 2")
    check(True, "admin adds a user")
    A.click("#usrx")

    C_ctx, C = device()
    sign_in(C, "maria", "mariapass123")
    C.wait_for_selector("#fmm", state="hidden")
    C.wait_for_selector("#acw:not([hidden])", state="attached")
    check(names(C) == [], "the new user starts with empty data")
    profile(C)
    check(not C.is_visible('[data-ac="usrm"]'), "a normal user has no Manage users button")
    C.click("#pfx")
    add_expense(C, "Maria only", 1)
    check("Maria only" not in names(A), "users cannot see each other's data")
    check(C.evaluate("fetch('/api/admin/users').then(r=>r.status)") == 403, "a normal user cannot use the admin API")

    A.click('[data-ac="usrm"]')
    A.wait_for_selector(".usrr")
    A.click('.usrr:has(b:text-is("maria")) [data-um="act"]')
    A.wait_for_function("document.querySelector('.usrr.off') !== null")
    A.click("#usrx")
    come_back(C)
    C.wait_for_selector("#fmm:not([hidden])")
    check("Maria only" not in (C.text_content("#sec") or ""), "a disabled user is signed out and their data leaves the screen")

    # ---- signing out
    profile(A)
    A.click('[data-ac="out"]')
    A.wait_for_selector("#dlg:not([hidden])")
    A.click("#dlgy")
    A.wait_for_selector("#fmm:not([hidden])")
    check(A.evaluate("fetch('/api/data').then(r=>r.status)") == 401, "signed out: the server no longer answers this browser")

    # ---- Greek
    sign_in(A, "admin", "adminpass123")
    A.wait_for_selector("#fmm", state="hidden")
    A.click("#langb"); A.click('#langm [data-l="el"]')
    A.wait_for_timeout(300)
    check(A.text_content("#act") == "Λογαριασμός", "account block is translated")

    check(not errors, "no script errors: %s" % errors)
    browser.close()

print()
print("%d FAILED" % len(failures) if failures else "ALL OK")
sys.exit(1 if failures else 0)
