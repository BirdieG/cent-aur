"""End-to-end test of Cent-aur against a fresh server: run it with tests/run-tests.sh.

Covers the first sign-in with admin/admin, saving, two devices, edits clashing between devices,
losing the connection, managing users, the backup download and signing out.
"""
import datetime, json, os, sys, time
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

    # ---- an amount typed with a comma (Greek keypad) is taken as a decimal; letters and 0 are refused
    A.fill("#amt", "")
    A.type("#amt", "12,5x0")
    check(A.input_value("#amt") == "12.50", "a comma in an amount becomes a dot and letters are refused (%s)" % A.input_value("#amt"))
    A.fill("#amt", "0")
    check(not A.evaluate("document.getElementById('amt').checkValidity()"), "an amount of 0 is refused")
    A.fill("#amt", "")
    A.type("#amt", "3,75")
    A.fill("#name", "Comma test")
    A.select_option("#freq", "0")
    with A.expect_response(lambda r: "/api/data" in r.url and r.request.method == "PUT" and r.ok):
        A.click("#sb")
    amt = [i["amt"] for i in data_of(A)["data"]["items"] if i["name"] == "Comma test"]
    check(amt == [3.75], "an expense typed as 3,75 is saved as 3.75 (%s)" % amt)
    A.fill("#q", "Comma test")
    A.click("#sec .row:has-text('Comma test') .del")
    A.click("#dlgy")
    A.fill("#q", "")
    check(A.is_hidden("#fmm"), "signed in: the starting cover lifts once the data is on screen")
    check(A.evaluate("getComputedStyle(document.documentElement).overflowY") != "hidden", "signed in: the page scrolls again")
    check(A.evaluate("localStorage.getItem('expense-calc-v2')") is None, "nothing is kept in the browser's storage")

    # ---- a note on an expense: saved, shown under the row, searchable, removed when cleared
    check(A.is_hidden("#note") and A.is_visible("#nlk"), "note box stays closed until + Add note is pressed")
    A.click("#nlk")
    A.fill("#note", "Paid by card, refund pending")
    add_expense(A, "Note test", 25)
    item = next(i for i in data_of(A)["data"]["items"] if i["name"] == "Note test")
    check(item.get("note") == "Paid by card, refund pending", "note is saved with the expense")
    check(A.is_hidden("#note"), "note box closes again after adding")
    A.reload()
    A.wait_for_selector("#sec .nt")
    check("refund pending" in A.inner_text("#sec .nt"), "note shows under the expense after reloading")
    A.fill("#q", "refund")
    A.wait_for_timeout(400)
    rows = A.eval_on_selector_all("#sec .row", "rs => rs.map(r => r.textContent)")
    check(len(rows) == 1 and "Note test" in rows[0], "search finds an expense by its note")
    A.fill("#q", "")
    A.click('#sec .ed[data-id="%s"]' % item["id"])
    check(A.input_value("#note") == "Paid by card, refund pending", "editing an expense shows its note")
    A.fill("#note", "")
    with A.expect_response(lambda r: "/api/data" in r.url and r.request.method == "PUT" and r.ok):
        A.click("#sb")
    item = next(i for i in data_of(A)["data"]["items"] if i["name"] == "Note test")
    check("note" not in item, "clearing the note removes it")

    # ---- number boxes refuse "e" and "+" (the browser would accept 1e5)
    A.fill("#amt", "")
    A.click("#amt")
    A.keyboard.type("1e+5")
    check(A.input_value("#amt") == "15", "amount box ignores e and + (%r)" % A.input_value("#amt"))
    A.fill("#amt", "")

    # ---- every dropdown looks and behaves like the Category picker; the Tags box shows no arrow
    look = """b => { const s = getComputedStyle(b); return [s.backgroundColor, s.backgroundImage, s.borderColor, s.borderRadius, s.cursor, s.color, s.fontSize, s.height] }"""
    A.hover("#freq"); hf = A.eval_on_selector("#freq", look)
    A.hover("#ddb"); hc = A.eval_on_selector("#ddb", look)
    check(hf == hc, "How often and Category look the same under the mouse (%s, %s)" % (hf, hc))
    check(A.evaluate("[...document.querySelectorAll('select')].every(s => getComputedStyle(s).appearance === 'none')"), "no select on the page is drawn by the browser")
    A.click("#ddb"); A.click("#ddm button:has-text('Housing')")
    fit = A.eval_on_selector("#ddb .dl", "e => [e.scrollWidth, e.clientWidth]")
    check(fit[0] <= fit[1], "the arrow leaves room for the category's name: Housing is not cut off (%s)" % fit)
    A.click("#freq")
    A.wait_for_selector(".slm")
    check(A.locator(".slm li").count() == 7 and A.get_attribute(".slm li[aria-selected=true]", "data-i") == str(A.evaluate("document.getElementById('freq').selectedIndex")), "How often opens its own list, with the current choice marked")
    def box_of(sel):
        return A.eval_on_selector(sel, "e => { const s = getComputedStyle(e); return [s.backgroundColor, s.borderColor, s.borderRadius, s.boxShadow] }")
    fb = box_of(".slm")
    A.click("#ddb")
    check(A.locator(".slm").count() == 0, "opening the Category list closes the other")
    check(box_of("#ddm") == fb, "both lists are drawn alike (%s, %s)" % (box_of("#ddm"), fb))
    A.click("#ddb")
    A.click("#freq")
    A.click("#freq")
    check(A.locator(".slm").count() == 0, "clicking a dropdown again closes its list")
    A.focus("#freq")
    A.keyboard.press("Enter")
    A.wait_for_selector(".slm")
    A.keyboard.press("Home"); A.keyboard.press("ArrowDown"); A.keyboard.press("Enter")
    check(A.input_value("#freq") == "365", "the keyboard picks a choice (%s)" % A.input_value("#freq"))
    A.keyboard.press("Enter"); A.wait_for_selector(".slm"); A.keyboard.press("Escape")
    check(A.locator(".slm").count() == 0 and A.evaluate("document.activeElement.id") == "freq", "Escape closes the list and returns to the dropdown")
    A.click("#freq"); A.click(".slm li:has-text('One-time')")
    check(A.input_value("#freq") == "0" and A.is_hidden("#endw"), "picking from the list acts like changing the select: Ends after goes away")
    A.click("#gear"); A.click("#mode"); A.wait_for_selector(".slm")
    check(A.is_visible("#opt"), "opening a dropdown inside Settings leaves Settings open")
    A.keyboard.press("Escape")
    check(A.is_visible("#opt"), "and Escape closes only the list")
    A.click("#optx")
    profile(A)
    A.click("#pay"); A.wait_for_selector(".slm")
    over = A.evaluate("""(() => { const r = document.querySelector('.slm li').getBoundingClientRect(); return !!document.elementFromPoint(r.left + 5, r.top + 5).closest('.slm') })()""")
    check(over, "a dropdown's list shows above the Profile window")
    with A.expect_response(lambda r: "/api/data" in r.url and r.request.method == "PUT" and r.ok):
        A.click(".slm li:has-text('14.5')")
    check(data_of(A)["data"]["payments"] == 14.5 and A.is_visible("#pfov"), "picking there saves, and Profile stays open")
    with A.expect_response(lambda r: "/api/data" in r.url and r.request.method == "PUT" and r.ok):
        A.select_option("#pay", "12")
    A.click("#pfx")
    A.wait_for_timeout(300)
    T_ctx = browser.new_context(viewport={"width": 390, "height": 800}, has_touch=True, is_mobile=True, bypass_csp=True)
    T = T_ctx.new_page()
    T.goto(BASE); T.wait_for_selector("#fmf"); T.fill("#fm_u", "admin"); T.fill("#fm_p", "adminpass123"); T.tap("#fmo"); T.wait_for_selector("#fmm", state="hidden")
    r = T.locator("#freq").bounding_box()
    T.touchscreen.tap(r["x"] + r["width"] / 2, r["y"] + r["height"] / 2)
    T.wait_for_selector(".slm")
    h = T.eval_on_selector(".slm li", "e => e.getBoundingClientRect().height")
    w = T.evaluate("(() => { const r = document.querySelector('.slm').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth })()")
    check(h >= 44 and w, "on a touch screen a tap opens the list: rows at least 44px, inside the screen (%s)" % h)
    T.tap(".slm li:has-text('Weekly')")
    check(T.input_value("#freq") == "52", "and a tap picks a choice")
    T_ctx.close()
    check(A.evaluate("""[...document.styleSheets].some(s => [...s.cssRules].some(r => (r.selectorText || '').includes('input[list]::-webkit-calendar-picker-indicator') && r.style.display === 'none'))"""), "the rule that hides the Tags box's dropdown arrow is in place")

    # ---- import from Excel: columns guessed from the headings, row without an amount skipped, Undo takes it all back
    A.set_input_files("#xlf", os.path.join(os.path.dirname(os.path.abspath(__file__)), "expenses-sample.xlsx"))
    A.wait_for_selector("#xlm:not([hidden]) .xls")
    check(A.input_value('#xlb select[data-xl="date"]') == "0" and A.input_value('#xlb select[data-xl="amt"]') == "3", "import finds the Date and Price columns by their headings")
    check("6 expenses will be added" in A.inner_text("#xlb .xls"), "import counts the rows it will add, skipping one without an amount")
    with A.expect_response(lambda r: "/api/data" in r.url and r.request.method == "PUT" and r.ok):
        A.click("#xly")
    items = data_of(A)["data"]["items"]
    d = [i for i in items if i["name"] == "Dentist"]
    check(len(d) == 1 and d[0]["date"] == "2026-10-20" and d[0]["amt"] == 80 and d[0]["cat"] == "Health" and d[0].get("note") == "filling, pay rest in Dec",
          "imported expense has its date, amount, category and note (%s)" % d)
    check(len([i for i in items if i["name"] in ("Lidl", "Rent", "Shell", "Coffee Island", "Dentist")]) == 6, "all six rows are imported")
    with A.expect_response(lambda r: "/api/data" in r.url and r.request.method == "PUT" and r.ok):
        A.click("#toastu")
    check(not any(i["name"] == "Dentist" for i in data_of(A)["data"]["items"]), "Undo removes the whole import")

    # ---- reminders: set when adding a bill, moved on when the next bill is paid, deleted from Profile
    def add_bill(page, cat, amount, date):
        page.click("#ddb")
        page.click("#ddm button:has-text('%s')" % cat)
        page.fill("#amt", str(amount))
        page.fill("#dt", date)
    A.click("#ddb")
    A.click("#ddm button:has-text('Housing')")
    check(A.is_hidden("#rmw"), "no Set a reminder for a category that isn't a bill")
    add_bill(A, "Electricity", 60, "2026-01-15")
    check(A.is_visible("#rmt"), "Set a reminder shows for a bill")
    check(A.is_enabled("#freq") and A.input_value("#freq") == "0", "a bill starts as one-time, and How often can still be changed")
    A.click("#rmt")
    check(A.input_value("#rmd") == "2026-02-15", "the reminder's date starts one month after the bill (%s)" % A.input_value("#rmd"))
    with A.expect_response(lambda r: "/api/data" in r.url and r.request.method == "PUT" and r.ok):
        A.click("#sb")
    rems = data_of(A)["data"].get("rems", [])
    check(len(rems) == 1 and rems[0]["cat"] == "Electricity" and rems[0]["rep"] == "m" and rems[0]["date"] == "2026-02-15", "the reminder is saved (%s)" % rems)
    add_bill(A, "Electricity", 64, "2026-02-10")
    check(A.is_hidden("#rmt") and "next 15/02/2026" in A.inner_text("#rmi"), "a bill with a reminder says so instead of offering a new one")
    with A.expect_response(lambda r: "/api/data" in r.url and r.request.method == "PUT" and r.ok):
        A.click("#sb")
    rems = data_of(A)["data"].get("rems", [])
    check(len(rems) == 1 and rems[0]["date"] == "2026-03-15", "paying the bill moves the reminder to the next month (%s)" % rems)
    # a second house: its own reminder in the same category, tied to its own name
    add_bill(A, "Electricity", 30, "2026-02-20")
    A.fill("#name", "Electricity Beach house")
    check(A.is_visible("#rmt"), "another bill name in the same category can get its own reminder")
    A.click("#rmt")
    with A.expect_response(lambda r: "/api/data" in r.url and r.request.method == "PUT" and r.ok):
        A.click("#sb")
    rems = {r["name"]: r["date"] for r in data_of(A)["data"].get("rems", [])}
    check(rems == {"Electricity": "2026-03-15", "Electricity Beach house": "2026-03-20"}, "two Electricity reminders, one per name (%s)" % rems)
    profile(A)
    A.click("#rmo")
    check(A.locator("#rml .rmr").count() == 2, "Profile → Reminders lists both reminders")
    with A.expect_response(lambda r: "/api/data" in r.url and r.request.method == "PUT" and r.ok):
        A.click("#rml .rmr:has-text('Beach house') [data-rmd]")
        A.click("#dlgy")
    rems = [r["name"] for r in data_of(A)["data"].get("rems", [])]
    check(rems == ["Electricity"], "deleting a reminder removes only that one (%s)" % rems)
    check(sum(1 for i in data_of(A)["data"]["items"] if i["cat"] == "Electricity") == 3, "the bills stay after deleting their reminder")
    A.click("#rmc")
    A.click("#pfx")
    # the remaining reminder (15 March, so overdue now) offers its average so far, and Paid adds the bill without the form
    box = A.locator(".ri:has-text('Electricity') [data-rqa]")
    check(box.input_value() == "62.00", "a due reminder asks how much it was, filled in with the average of its bills (%s)" % box.input_value())
    check(A.is_visible("#yest") and "still expected" in A.inner_text("#yest"), "the year shows the bills still expected, apart with ≈")
    box.fill("66")
    with A.expect_response(lambda r: "/api/data" in r.url and r.request.method == "PUT" and r.ok):
        A.click(".ri:has-text('Electricity') [data-rqs]")
    d = data_of(A)["data"]
    check(any(i["name"] == "Electricity" and i["amt"] == 66 and i["date"] == "2026-03-15" for i in d["items"]), "Paid adds the bill on its due date")
    check([r["date"] for r in d["rems"]] == ["2026-04-15"], "and moves the reminder on (%s)" % d["rems"])
    # repeating, but the amount changes: saved as this one payment plus a reminder, never as a fixed monthly amount
    A.fill("#amt", "25")
    A.fill("#name", "Gym")
    A.select_option("#freq", "12")
    check(A.is_visible("#vyw") and not A.is_visible("#rmw"), "a repeating expense offers “The amount changes each time”")
    A.check("#vy")
    A.fill("#dt", "2026-04-01")
    check(A.is_visible("#endw"), "it still offers Ends after")
    A.fill("#endm", "2026-08")
    with A.expect_response(lambda r: "/api/data" in r.url and r.request.method == "PUT" and r.ok):
        A.click("#sb")
    d = data_of(A)["data"]
    gym = [i["freq"] for i in d["items"] if i["name"] == "Gym"]
    rem = [(r["rep"], r["date"], r.get("v"), r.get("until")) for r in d["rems"] if r["name"] == "Gym"]
    check(gym == [0] and rem == [("m", "2026-05-01", 1, "2026-08")], "it is saved once, with a monthly reminder until its last month (%s %s)" % (gym, rem))
    # a future one-time expense can have a one-time reminder of its own, in any category
    soon = (datetime.date.today() + datetime.timedelta(days=5)).isoformat()
    A.fill("#amt", "150")
    A.fill("#name", "Car repairs")
    A.select_option("#freq", "0")
    A.fill("#dt", soon)
    A.dispatch_event("#dt", "change")
    check(A.is_visible("#rmt"), "a one-time expense dated in the future offers Set a reminder")
    A.click("#rmt")
    check(A.input_value("#rmd") == soon, "its reminder starts on the expense's date")
    with A.expect_response(lambda r: "/api/data" in r.url and r.request.method == "PUT" and r.ok):
        A.click("#sb")
    d = data_of(A)["data"]
    car = [i for i in d["items"] if i["name"] == "Car repairs"]
    rem = [(r["rep"], r["date"], r.get("item")) for r in d["rems"] if r["name"] == "Car repairs"]
    check(len(car) == 1 and rem == [("once", soon, car[0]["id"])], "the expense is saved with a one-time reminder tied to it (%s)" % rem)
    # after reloading, the reminders keep what they are; deleting the varying one says its estimates go too
    A.reload()
    A.wait_for_selector("#rmo", state="attached")
    profile(A)
    A.click("#rmo")
    gym_row = A.locator("#rml .rmr:has-text('Gym')")
    check("amount varies" in gym_row.inner_text() and "until" in gym_row.inner_text(), "after reloading, Gym still varies and ends (%s)" % gym_row.inner_text())
    gym_row.locator("[data-rmd]").click()
    check("estimates" in A.inner_text("#dlgm"), "deleting a varying reminder warns that its estimates go too")
    A.click("#dlgc")
    A.click("#rmc")
    A.click("#pfx")

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

    # ---- Savings goals, Spending by month and What if start hidden; View pushes the cards under it down, like Settings
    hid = A.evaluate("""['goals','trend','whatif','insights'].map(k => document.querySelector('.slot[data-card="'+k+'"]').hidden)""")
    check(hid == [True, True, True, False], "goals, spending by month and what if are hidden by default (%s)" % hid)
    A.click("#viewb")
    A.wait_for_selector("#viewp", state="visible")
    push = A.evaluate("""(() => { const p = document.getElementById('viewp').getBoundingClientRect(), c = document.getElementById('colR').getBoundingClientRect();
        return c.top >= p.bottom })()""")
    check(push, "the open View panel moves the right column down instead of covering it")
    with A.expect_response(lambda r: "/api/data" in r.url and r.request.method == "PUT" and r.ok):
        A.click("#viewp [data-view='trend']")
    check(data_of(A)["data"]["show"] == {"trend": True}, "ticking a card hidden by default is saved as shown")
    A.click("#viewx")
    A.reload()
    A.wait_for_selector("#fmm", state="hidden")
    check(A.is_visible(".slot[data-card='trend']"), "a card ticked in View stays shown after reloading")
    # the chart is drawn by ApexCharts from this server's own copy, and only once the card is shown
    A.wait_for_selector("#trapx svg.apexcharts-svg")
    src = A.evaluate("[...document.scripts].map(s => s.src).filter(s => s.includes('apexcharts'))")
    check(len(src) == 1 and src[0].startswith(BASE) and src[0].endswith("vendor/apexcharts-4.7.0.min.js"), "Spending by month is drawn with the local ApexCharts (%s)" % src)
    check(A.evaluate("document.querySelectorAll('#trapx .apexcharts-xaxis-label').length") == 12, "the chart names all 12 months")
    ax = A.request.get(BASE + "vendor/apexcharts-4.7.0.min.js", headers={"Accept-Encoding": "gzip"})
    check(ax.headers.get("content-encoding") == "gzip" and "immutable" in ax.headers.get("cache-control", ""), "ApexCharts is sent compressed and kept by the browser (%s, %s)" % (ax.headers.get("content-encoding"), ax.headers.get("cache-control")))
    dr = A.request.get(BASE + "api/data", headers={"Accept-Encoding": "gzip", "X-Requested-With": "CentAur"})
    check(dr.ok and dr.headers.get("content-encoding") == "gzip", "your data from /api/data is sent compressed (%s)" % dr.headers.get("content-encoding"))
    # folding Spending by month is remembered, like the other cards
    tf = '.slot[data-card="trend"] .head h2 > button.foldb'
    with A.expect_response(lambda r: "/api/data" in r.url and r.request.method == "PUT" and r.ok):
        A.click(tf)
    A.reload()
    A.wait_for_selector("#fmm", state="hidden")
    check(A.get_attribute(tf, "aria-expanded") == "false", "a folded Spending by month stays folded after reloading")
    with A.expect_response(lambda r: "/api/data" in r.url and r.request.method == "PUT" and r.ok):
        A.click(tf)
    A.wait_for_function("document.querySelector('#trapx svg.apexcharts-svg') && document.querySelector('#trapx svg.apexcharts-svg').getBoundingClientRect().width > 100")
    check(True, "unfolded again, the chart is drawn at full width")
    A.click("#viewb")
    A.click("#viewp [data-view='trend']")
    A.click("#viewx")

    # ---- a second device of the same person
    B_ctx, B = device(390)
    sign_in(B, "admin", "adminpass123")
    B.wait_for_selector("#fmm", state="hidden")
    B.wait_for_function("document.querySelector('#sec').textContent.includes('Rent test')")
    check(True, "second device (phone size) shows the same data")

    # ---- on a phone an expense row is two lines: ⋯ shows its pause, edit and delete, at least 44px each
    row = B.locator("#sec .row:has([data-more])").first
    check(row.locator(".del").is_hidden() and row.locator("[data-more]").is_visible(), "on a phone a row shows ⋯ instead of delete")
    row.locator("[data-more]").click()
    sizes = row.evaluate("r => [...r.querySelectorAll('.act button')].map(b => { const x = b.getBoundingClientRect(); return [Math.round(x.width), Math.round(x.height)] })")
    check(row.locator(".del").is_visible() and all(w >= 44 and h >= 44 for w, h in sizes), "⋯ shows the row's buttons, each at least 44px (%s)" % sizes)
    row.locator("[data-more]").click()
    # iPhone zooms into boxes with text under 16px; money boxes open the number keypad; Clear all sits under the list
    small = B.evaluate("""[...document.querySelectorAll('input:not([type=checkbox]):not([type=range]),select,textarea')]
        .filter(e => e.offsetParent && parseFloat(getComputedStyle(e).fontSize) < 16).map(e => e.id || e.className)""")
    check(small == [], "on a phone every box has text of at least 16px (%s)" % small)
    check(B.evaluate("[...document.querySelectorAll('input[data-num]')].every(e => e.inputMode === 'decimal' && e.type === 'text')"), "amount boxes are text boxes with the number keypad")
    check(B.evaluate("document.getElementById('sec2').nextElementSibling === document.getElementById('clear')"), "on a phone Clear all sits under the list")
    # keyboard: names and tags are not autocorrected, tags not capitalised; a short header; Close at the bottom of Profile
    kb = B.evaluate("[document.getElementById('name').getAttribute('autocorrect'), document.getElementById('tags').getAttribute('autocapitalize'), document.getElementById('q').enterKeyHint]")
    check(kb == ["off", "off", "search"], "phone keyboard settings on Name, Tags and Search (%s)" % kb)
    check(B.is_hidden("p.sub"), "on a phone the tagline is left out of the header")
    profile(B)
    check(B.locator("#pfov .dlgcls").is_visible(), "Profile has a Close button at the bottom on a phone")
    B.click("#pfov .dlgcls")
    B.wait_for_selector("#pfov", state="hidden")
    check(B.evaluate("document.querySelector('meta[name=theme-color]').content") == B.evaluate("getComputedStyle(document.body).backgroundColor"), "the browser bar colour follows the page background")
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

    # ---- merging a backup also brings reminders and paid VAT periods, without doubling what is here
    def saved_after(page, act):
        with page.expect_response(lambda r: "/api/data" in r.url and r.request.method == "PUT" and r.ok):
            act()
        return data_of(page)["data"]
    def merge_file(doc):
        return {"name": "backup.json", "mimeType": "application/json", "buffer": json.dumps(doc).encode()}
    backup = {"items": [{"id": "it1", "name": "Car repairs", "amt": 150, "freq": 0, "cat": "Other", "date": "2030-01-10", "created": "2026-01-01"}],
              "rems": [{"id": "r1", "cat": "Electricity", "name": "Electricity", "date": "2030-02-15", "rep": "m", "day": 15},
                       {"id": "r2", "cat": "Other", "name": "Car repairs", "date": "2030-01-05", "rep": "once", "item": "it1"},
                       {"id": "r3", "cat": "Other", "name": "Ghost", "date": "2030-01-05", "rep": "once", "item": "not-here"}],
              "fl": {"vat": {"paid": {"2026-Q1": True}}}}
    d = saved_after(C, lambda: C.set_input_files("#mgf", merge_file(backup)))
    check(sorted(r["id"] for r in d["rems"]) == ["r1", "r2"], "merge adds reminders, but not one whose expense is missing (%s)" % d["rems"])
    check(d["fl"]["vat"]["paid"] == {"2026-Q1": True}, "merge adds paid VAT periods")
    C.wait_for_timeout(400)
    backup["rems"][0]["id"] = "r9"  # the same bill under another id
    backup["items"].append({"id": "it2", "name": "New one", "amt": 5, "freq": 0, "cat": "Other", "date": "2030-01-11", "created": "2026-01-01"})
    d = saved_after(C, lambda: C.set_input_files("#mgf", merge_file(backup)))
    check(sorted(r["id"] for r in d["rems"]) == ["r1", "r2"], "merging again does not double the reminders (%s)" % d["rems"])
    C.wait_for_timeout(400)

    # ---- Clear all takes the reminders tied to those expenses with it, and Undo brings them back
    C.click("#clear")
    d = saved_after(C, lambda: C.click("#dlgy"))
    check(d["items"] == [] and [r["id"] for r in d["rems"]] == ["r1"], "Clear all also removes reminders tied to the expenses (%s)" % d["rems"])
    d = saved_after(C, lambda: C.click("#toastu"))
    check(len(d["items"]) > 0 and sorted(r["id"] for r in d["rems"]) == ["r1", "r2"], "Undo brings the expenses and their reminders back (%s)" % d["rems"])
    C.wait_for_timeout(400)

    # ---- renaming a category carries its learned names and own merchants along
    C.fill("#amt", "4"); C.fill("#name", "Corner shop")
    C.click("#ddb"); C.click("#ddm button:has-text('Leisure')")
    C.select_option("#freq", "0")
    saved_after(C, lambda: C.click("#sb"))
    C.wait_for_timeout(400)
    C.click("#mrt"); C.fill("#mrq", "My Own Shop")
    C.select_option("#mrnc", "Leisure")
    saved_after(C, lambda: C.click('#mrl [data-ml="new"]'))
    C.wait_for_timeout(400)
    C.click("#mrt")
    C.click("#cadd")
    C.click('#cl .crow:has-text("Leisure") [data-ce]')
    C.fill("#cn", "Fun")
    d = saved_after(C, lambda: C.click("#cs"))
    check(d["learn"].get("corner shop", {}).get("c") == "Fun", "a learned name follows the category's new name (%s)" % d["learn"].get("corner shop"))
    check([m["c"] for m in d["mer"].values() if m.get("u")] == ["Fun"], "an own merchant follows the category's new name")
    C.click("#cadd")
    C.wait_for_timeout(400)

    # ---- every message the server can send has Greek
    js = C.evaluate("fetch('/app.js').then(r=>r.text())")
    for m in ["Please sign in.", "Please choose a new password first.", "Not found.", "Not allowed.", "Bad request.", "Your data was changed on another device.", "Blocked: wrong origin.", "Blocked: missing header.", "That folder already has Cent-aur data.", "Something went wrong on this PC."]:
        check('"%s":"' % m in js, "Greek exists for: %s" % m)

    # ---- the health check says nothing about the version; a faked X-Forwarded-Proto does not change the cookie
    check(C.evaluate("fetch('/api/health').then(r=>r.json())") == {"ok": True}, "the health check does not tell the version")
    api = pw.request.new_context()
    r = api.post(BASE + "api/login", headers={"X-Requested-With": "CentAur", "X-Forwarded-Proto": "https"}, data={"username": "maria", "password": "mariapass123"})
    cookie = r.headers.get("set-cookie", "")
    check(r.ok and "ca_session" in cookie and "secure" not in cookie.lower(), "X-Forwarded-Proto from just anyone is not believed (%s)" % cookie.split(";", 1)[-1])
    api.dispose()

    # ---- the page runs under a policy that allows no inline scripts at all (the page's own part is ready for it)
    Z_ctx = browser.new_context()
    Z = Z_ctx.new_page()
    strict = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'"
    def with_strict(route):
        res = route.fetch()
        route.fulfill(response=res, headers={**res.headers, "content-security-policy": strict})
    Z.route(BASE, with_strict)
    bad = []
    Z.on("console", lambda m: bad.append(m.text) if m.type == "error" and "Content Security Policy" in m.text else None)
    Z.on("pageerror", lambda e: bad.append(str(e)))
    calls2 = []
    Z.on("request", lambda r: "/api/" in r.url and calls2.append(r.url.split("/api/")[1]))
    Z.goto(BASE)
    Z.fill("#fm_u", "maria"); Z.fill("#fm_p", "mariapass123"); Z.click("#fmo")
    Z.wait_for_selector("#fmm", state="hidden")
    Z.reload()
    Z.wait_for_selector("#fmm", state="hidden")
    check(not bad, "no inline script is needed: nothing is blocked by a strict policy (%s)" % bad[:2])
    check(calls2[-1:] == ["session?data=1"], "under it the page still asks the server once (%s)" % calls2)
    ran = Z.evaluate("(() => { const s = document.createElement('script'); s.textContent = 'window.__inl = 1'; document.head.appendChild(s); return !!window.__inl })()")
    check(not ran, "the strict policy really was in force: an inline script is blocked")
    Z_ctx.close()

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
    A.click("#gear")
    A.wait_for_selector("#freel", state="visible")
    size = A.eval_on_selector("#freel", "e => { const r = e.getBoundingClientRect(); return [r.width, r.height] }")
    check(size[0] == size[1] and size[0] >= 13, "in Greek the long label does not squeeze the freelancer checkbox away (%s)" % size)
    A.click("#optx")

    check(not errors, "no script errors: %s" % errors)
    browser.close()

print()
print("%d FAILED" % len(failures) if failures else "ALL OK")
sys.exit(1 if failures else 0)
