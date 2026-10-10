#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Builds seed/full-checklist.json: every public page, every CMS screen, every-page checks, background jobs.
CMS screens are read from the Lokalnyt source code (column/field definitions, buttons, tabs, messages, sidebar roles).

Usage:  python3 tools/build_checklist.py [/path/to/Lokalnyt]
"""
import sys, os, re, glob, json, html
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import public_data as P

REPO = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Documents/Lokalnyt")
SRC = os.path.join(REPO, "apps/web/src") + "/"
CMS = SRC + "routes/cms/(pages)/"
SIDEBAR = os.path.join(REPO, "packages/ui/src/components/navigation/SidebarNav.svelte")
if not os.path.isdir(CMS):
    sys.exit(f"Cannot find the CMS pages at {CMS}. Pass the Lokalnyt folder as the first argument.")

# ---------------------------------------------------------------- code parsing helpers
def balanced(s, start, o, c):
    d = 0
    for i in range(start, len(s)):
        if s[i] == o: d += 1
        elif s[i] == c:
            d -= 1
            if d == 0: return i
    return len(s) - 1
def top_objects(arr):
    out = []; i = 0
    while i < len(arr):
        if arr[i] == "{":
            j = balanced(arr, i, "{", "}"); out.append(arr[i:j + 1]); i = j + 1
        else: i += 1
    return out
def val(obj, key):
    depth = 0; flat = []
    for ch in obj:
        if ch in "{[": depth += 1
        if depth <= 1: flat.append(ch)
        if ch in "}]": depth -= 1
    m = re.search(rf"\b{key}:\s*(?:'([^']*)'|\"([^\"]*)\"|`([^`]*)`|(true|false|[0-9]+))", "".join(flat))
    return next((g for g in m.groups() if g is not None), None) if m else None
def parse_arrays(path, exported_only=False):
    s = open(path, encoding="utf8").read(); out = {}
    pat = r"export const (\w+)\s*(?::\s*Column\[\])?\s*=\s*\[" if exported_only else r"(?:const|let)\s+(\w+)\s*(?::\s*[A-Za-z\[\]<>]+)?\s*=\s*(?:\$derived\(\s*)?\["
    for m in re.finditer(pat, s):
        a = m.end() - 1; b = balanced(s, a, "[", "]"); cols = []
        for o in top_objects(s[a + 1:b]):
            lab = val(o, "label") or val(o, "header") or val(o, "title")
            cid = val(o, "id") or val(o, "key") or val(o, "name") or lab
            if not lab or not cid: continue
            opts = []
            om = re.search(r"options:\s*\[", o)
            if om:
                oa = om.end() - 1; ob = balanced(o, oa, "[", "]")
                opts = re.findall(r"label:\s*'([^']+)'", o[oa:ob + 1])
            cols.append(dict(id=cid, label=lab, table=val(o, "tableLabel"), type=val(o, "type") or "text", required=val(o, "required") == "true",
                             sortable=val(o, "sortable") == "true", filterable=val(o, "filterable") == "true", visible=val(o, "visible") != "false",
                             isForm=(val(o, "isForm") == "true") if exported_only else True, options=opts))
        if len(cols) >= (1 if exported_only else 2): out[m.group(1)] = cols
    return out
def template(src):
    s = re.sub(r"<script[\s\S]*?</script>", "", src); s = re.sub(r"<style[\s\S]*?</style>", "", s)
    return re.sub(r"<!--[\s\S]*?-->", "", s)
def clean(t):
    t = re.sub(r"\{[^{}]*(\{[^{}]*\}[^{}]*)*\}", " ", t); t = re.sub(r"<[^>]+>", " ", t)
    return re.sub(r"\s+", " ", html.unescape(t)).strip(" :*|- ")
def buttons(src):
    out = []
    for m in re.finditer(r"<button([^>]*)>([\s\S]*?)</button>", template(src)):
        t = clean(m.group(2))
        if "}>" in t: t = t.split("}>")[-1]
        t = re.sub(r"^[\s>}\)]+", "", t); t = re.sub(r"\(\s*\)", "", t).strip(" >")
        if 3 <= len(t) <= 40 and not re.search(r"[=;{}]|\.set|dispatch", t) and t.lower() not in ("close", "luk", "annuller", "slet", "gem") and t not in out: out.append(t)
    return out
def tabs(src):
    out = []
    for a, b in re.findall(r"\{\s*label:\s*'([^']+)',\s*value:\s*'([^']*)'", src):
        if a not in out: out.append(a)
    return out
def messages(src):
    out = []
    for m in re.findall(r"message:\s*(?:'([^']{8,90})'|\"([^\"]{8,90})\")", src):
        t = next(x for x in m if x)
        if t not in out and not re.search(r"[{}$]", t): out.append(t)
    return out

# ---------------------------------------------------------------- sidebar roles
side = {}
for line in open(SIDEBAR, encoding="utf8").read().splitlines():
    m = re.search(r"href:\s*'(/cms[^']*)'.*?title:\s*'([^']+)'(?:.*?roles:\s*\[([^\]]*)\])?", line)
    if m: side[m.group(1)] = (m.group(2), bool(m.group(3) and "admin" in m.group(3)))

# column sets shared in apps/web/src/types
SETS = {}
for p in glob.glob(SRC + "types/*.ts"): SETS.update(parse_arrays(p, exported_only=True))

MODS = [
 ("nyheder","News (Nyheder)","The article shows on /nyheder, the home page and /article/[slug] once published","trash"),
 ("kalender","Calendar (Kalender)","The event shows on /kalender on its date and on /kalender/[slug]","trash"),
 ("virksomheder","Companies (Virksomheder)","Company cards and company pages on the home page, listing pages and /article/[slug]","trash"),
 ("jobs","Jobs","Job cards on the home page and the jobs lists","trash"),
 ("offers","Offers (Tilbud)","Offer cards on /tilbud and the home page while the offer is valid","trash"),
 ("know-your-city","Know Your City","Places on /kend-din-by","trash"),
 ("place","Place","Place data used by Know Your City and company pages","trash"),
 ("kommune","Kommune","Municipality pages under /kommune","trash"),
 ("media","Media library (Medier)","Images and videos used everywhere on the site","confirm"),
 ("categories","Categories (Kategorier)","Menus, category pages and category tabs","confirm"),
 ("sub-categories","Sub-categories (Underkategorier)","Sub-category pages and filters","confirm"),
 ("tags","Tags","Tag filter on /nyheder and article tags","confirm"),
 ("content-management","Content management (Indholdsstyring)","Topics and questions that create content for the site","confirm"),
 ("questions","Questions","Questions used by the content workflow","confirm"),
 ("topics","Topics","Topics used to create content","confirm"),
 ("page-content","Page content","Text on static pages","confirm"),
 ("pages","Pages","Static pages in the menu","confirm"),
 ("cities","Cities (Byer)","Which city each domain shows; city name in header and titles","confirm"),
 ("menus","Menus","The header menu on every page","confirm"),
 ("seo","SEO","Browser tab title and description of the page","confirm"),
 ("themes","Themes (Temaer)","Theme pages under /temaer/[slug]","confirm"),
 ("ads","Ads","Ads in the chosen positions and dates","confirm"),
 ("coupons","Coupons (Rabatkoder)","Coupon emails to customers","confirm"),
 ("prompt","AI prompts (Prompt)","Instructions used by the AI features in the CMS","confirm"),
 ("e-newspaper-list","E-newspapers list (E-aviser)","Editions listed on /e-avis","confirm"),
 ("e-newspaper","E-newspaper editor","The edition shown in the flip-book on /e-avis","confirm"),
 ("customer-claim-requests","Customer portal requests","Company ownership after approval","confirm"),
 ("house","Houses (Huse)","'Fremhævede boliger' on the home page","confirm"),
 ("cars","Cars (Biler)","'Bilnyt' on the home page","confirm"),
 ("users","Users (Brugere)","Who can log in to the website and the CMS","confirm"),
 ("profilindstillinger","Profile settings","The logged-in user's own details","none"),
 ("web-crawling","Web crawling","Content collected from other websites","confirm"),
 ("cron-logs","Cron logs","Nothing public: shows whether background jobs ran","none"),
 ("skraldespand","Trash (Skraldespand)","Restored items return to their module and the public site","none"),
]
HIGH_PUBLIC = {"nyheder", "kalender", "offers", "menus", "ads", "cities", "media"}

items = []
def add(area, group, title, steps, expected, priority, **kw):
    items.append(dict(area=area, group=group, title=title, steps=steps, expected=expected, priority=priority, **kw))

# ---- automated checks (results are written by the tool itself)
AUTO = [
 ("AUTO-01","Home page responds","GET the home page","HTTP 200, HTML with a title, answers in under 5 seconds, no server-error text.","high"),
 ("AUTO-02","robots.txt and sitemap.xml","GET /robots.txt and /sitemap.xml and request 5 URLs from the sitemap","Both return 200; sitemap is valid XML; the sampled URLs return 200.","high"),
 ("AUTO-03","Key public pages respond","GET every address in config/urls.json","Every page returns 200 with HTML (no 4xx/5xx).","high"),
 ("AUTO-04","Unknown address gives a friendly 404","GET a made-up address","HTTP 404, HTML page, no stack trace or technical error text.","medium"),
 ("AUTO-05","Health endpoint","GET /api/health","HTTP 200.","high"),
 ("AUTO-06","No console errors on the home page (browser)","Open the home page in a real browser and watch the console","No console errors and no failed same-site requests.","medium"),
 ("AUTO-07","Cookie banner shows once and is remembered (browser)","Fresh browser: look for the banner, accept, reload","Banner is visible on first visit; after accepting and reloading it is gone.","high"),
 ("AUTO-08","Menu links work (browser)","Open home, collect the header menu links and open each","Every menu link returns 200 and shows a page (no not-found).","high"),
]
for id_, t, st, ex, pr in AUTO:
    items.append(dict(id=id_, area="Automated checks", group="Runs by itself on every deployment", title=t, steps=st, expected=ex, priority=pr, auto=True))

# ---- quick test (most important manual checks)
QUICK = [
 ("Home page opens","Open the city site (home page).","All sections show content and images; header and footer are there; no red console errors.","Public website"),
 ("Menu works","Click every menu item; open the phone menu.","Every item opens the right page, no 'not found'; phone menu opens and closes.","Public website"),
 ("Cookie banner","Open in a fresh private window.","Banner shows once; your choice is remembered after reload.","Every page"),
 ("News list","Open /nyheder and click 'Indlæs flere'.","Cards are complete; 6 more load per click, no duplicates.","Public website"),
 ("Picture or video thumbnails","Look at a news item with an image and one with a video.","Each shows the right kind of thumbnail; no broken images.","Public website"),
 ("Article page","Open any article.","Title, picture/video, text, tags, related news and share work.","Public website"),
 ("Video plays","Play the video in a video article (also on iPhone).","Plays inline with controls, no sound on its own.","Public website"),
 ("Search","Search a known word and 'æøå' on /soeg.","Relevant results; Danish letters work; nothing breaks.","Public website"),
 ("Offers","Open /tilbud and a category and one offer.","Only active offers; offer page shows company, price, dates.","Public website"),
 ("Calendar","Open /kalender, change month, click a day.","Events for that day show; submit-event form validates.","Public website"),
 ("Login","Log in with a wrong then a correct password.","Wrong gives a general error; correct opens the profile.","Public website"),
 ("Register","Register a new user and confirm the mail.","Errors for bad input; account created; mail arrives; login works.","Public website"),
 ("Newsletter","Subscribe with a bad, a good and a duplicate email.","Bad email rejected; good one succeeds; duplicate handled without a second record.","Public website"),
 ("Contact form","Send /kontakt empty, then valid.","Errors for required fields; success message; mail and CMS record exist.","Public website"),
 ("Sitemap","Open /robots.txt and /sitemap.xml.","Both open; sitemap lists real public pages.","Public website"),
 ("CMS login","Log in at /cms/login (wrong then correct).","Correct password opens the dashboard; logout works.","CMS admin"),
 ("Create and publish news","In CMS > Nyheder create an article with an image, publish it, open it on the site.","Saved, appears in the list and on the public site with the image.","CMS admin"),
 ("Unpublish","Unpublish the article.","It disappears from the public site and lists.","CMS admin"),
 ("Upload media","Upload a jpg, an mp4 and a wrong file in Medier.","Valid files upload with previews; the wrong file is rejected.","CMS admin"),
 ("Menu and ads","Change a menu item and an ad in the CMS.","The public site shows the change (allow for cache).","CMS admin"),
]
for i, (t, st, ex, where) in enumerate(QUICK, 1):
    items.append(dict(id=f"Q-{i:02d}", area="Quick test", group=where, title=t, steps=st, expected=ex, priority="high"))

# ---- public website: sections + things to try (grouped by page)
for key, (name, urls, pr) in P.PAGES.items():
    group = f"{name} - {urls}"
    for (pg, sec, shows, src, load, detail, passif, empty, ov) in [s for s in P.SECTIONS if s[0] == key]:
        add("Public website", group, sec, f"Look for: {shows}.", passif, ov or pr, type="Section", when=P.LOAD[load] + (f". {detail}" if detail and load in "TLU" else ""), ifEmpty=empty, source=src, loadDetail=detail)
    for (pg, what, steps, passif, apr) in [a for a in P.ACTIONS if a[0] == key]:
        add("Public website", group, what, steps, passif, apr, type="Try this", when="After you do it")

# ---- every page
for t, st, ex, pr in P.EVERY: add("Every page", "All pages", t, st, ex, pr)

# ---- CMS admin
def names(cols, pred, n=12):
    out = []
    for c in cols:
        if pred(c):
            lab = c["table"] or c["label"] or c["id"]
            if lab and lab not in out and lab.lower() not in ("slet", "delete", "actions", "handlinger"): out.append(lab)
    return ", ".join(out[:n]) + (" …" if len(out) > n else "")
for d, en, pub_eff, delete in MODS:
    if not os.path.isdir(CMS + d): continue
    page = f"/cms/{d}"; group = f"{en} - {page}"
    files = sorted(glob.glob(CMS + d + "/**/*.svelte", recursive=True))
    src_all = "".join(open(f, encoding="utf8").read() for f in files)
    cols = []; used = []
    for n in re.findall(r"\b(\w+Columns)\b", src_all):
        if n in SETS and n not in used: used.append(n); cols += SETS[n]
    if not cols:
        for f in files:
            for _, cc in parse_arrays(f).items(): cols += cc
    seen = set(); cols = [c for c in cols if not (c["id"] in seen or seen.add(c["id"]))]
    side_title, admin_only = side.get(page, (None, False))
    A = "CMS admin"
    if side_title:
        add(A, group, "Who can open it", f"1. Log in as an admin and look for '{side_title}' in the left menu.\n2. Log in as a non-admin editor and look again.\n3. As the non-admin, type {page} in the address bar.",
            "Admin sees the menu item and the page opens. A non-admin does NOT see it and cannot open it by address." if admin_only else "Every CMS user sees the menu item and the page opens.", "high" if admin_only else "medium")
    tcols = names(cols, lambda c: c["visible"] and c["type"] not in ("actions", "checkBox")) if cols else ""
    add(A, group, "Open the list", f"1. Click '{side_title or en}' in the left menu.\n2. Wait for the table to load.\n3. Scroll to the page numbers.",
        "The table loads with records (or 'Ingen data tilgængelig' if empty), no error message." + (f" Columns shown: {tcols}." if tcols else "") + " Page numbers and 'Vis' (5, 10, 25, 50, 100 rows) work.", "high")
    if cols:
        srt = names(cols, lambda c: c["sortable"]); flt = names(cols, lambda c: c["filterable"])
        if srt or flt:
            add(A, group, "Search, sort and filter", "1. " + (f"Click the header of a sortable column ({srt}) twice.\n2. " if srt else "") + (f"Type in the column search ({flt}).\n3. " if flt else "") + "Click the reset button.",
                "Rows re-order ascending then descending; the list narrows to matching rows; reset restores all rows and the default order.", "medium")
        add(A, group, "Show or hide columns", "1. Click 'Kolonner'.\n2. Hide one column and show another.", "The table changes immediately and the choice stays after you switch tabs.", "low")
    req = names(cols, lambda c: c["required"] and c["isForm"]) if cols else ""
    opt = names(cols, lambda c: c["isForm"] and not c["required"] and c["type"] not in ("header", "button", "actions"), 14) if cols else ""
    add(A, group, "Create a new record", "1. Click 'Tilføj nyt'.\n2. Click Save with everything empty.\n3. Fill all required fields with realistic Danish text (include æøå).\n4. Save.",
        "Step 2: an error appears for each required field" + (f" ({req})" if req else "") + " and nothing is saved. Step 4: a green success message and the new record is in the list.", "high")
    if opt:
        add(A, group, "Fill in the optional fields", f"Fill each optional field: {opt}.\nSave and open the record again.",
            "Every value is saved exactly (including special characters). Dropdowns list the expected options. Dates, numbers and links accept valid values and reject invalid ones.", "medium")
    add(A, group, "Edit a record", "1. Click the edit (pencil) icon on a row.\n2. Change a value.\n3. Save.\n4. Reload the page.", "A success message shows and the change is still there after reload. Nothing else changed.", "high")
    if delete == "trash":
        add(A, group, "Delete and restore", "1. Click the delete icon on a row and confirm.\n2. Open Skraldespand.\n3. Restore the record.\nAlso try Cancel in the confirm box.",
            "The record leaves the list and the public site and is found in Skraldespand. Restore brings it back unchanged. Cancel keeps it.", "high")
    elif delete == "confirm":
        add(A, group, "Delete", "1. Click the delete icon on a row.\n2. Click Cancel.\n3. Delete again and confirm.", "Cancel keeps the record. Confirm removes it with a success message. A record in use shows a clear warning.", "high")
    tb = tabs(src_all)
    if tb: add(A, group, "Tabs / quick filters", "Click each tab in turn: " + ", ".join(tb[:12]) + ".", "Each tab shows only its records, the count matches the list, 'Alle' shows everything.", "medium")
    bt = []
    for f in files:
        for b in buttons(open(f, encoding="utf8").read()):
            if b not in bt: bt.append(b)
    if bt: add(A, group, "Special buttons on this page", "Use each button: " + ", ".join(bt[:10]) + ".", "Each button does what its name says, shows a loading state, then a success or error message, and the screen updates without a manual reload.", "medium")
    ms = messages(src_all)[:6]
    if ms: add(A, group, "Messages shown to the editor", "Trigger these situations: " + " | ".join(ms), "Each message appears at the right moment, in correct Danish, green for success and red for errors.", "low")
    add(A, group, "Effect on the public website", "After saving or publishing, open the matching public page. (The public cache can take time to refresh.)", pub_eff + ".", "high" if d in HIGH_PUBLIC else "medium")
for page, what, steps, exp, pr in [
 ("CMS login - /cms/login", "Log in", "1. Open /cms/login.\n2. Try a wrong password.\n3. Log in correctly.\n4. Refresh.\n5. Log out.", "Wrong password shows an error. Correct login opens the dashboard and stays after refresh. Logout returns to the login page.", "high"),
 ("CMS login - /cms/login", "Forgot and reset password", "1. Click forgot password and enter your email.\n2. Open the mail link.\n3. Set a new password.\n4. Use the same link again.", "Mail arrives, the new password works, the used link is rejected.", "high"),
 ("CMS dashboard - /cms", "Dashboard", "Open /cms after login.", "Counts and charts load and match the lists; shortcuts open the right modules.", "medium"),
 ("CMS layout - all /cms pages", "Left menu groups", "Open every item under INDHOLD, ORGANISATION, MARKETING, BRUGERE & ADGANG and SYSTEM. On phone open and close the menu.", "Each item opens the right page and is highlighted; the menu works on phone.", "medium"),
 ("Table: record details - any /cms list", "Row detail panel", "Click a row (or the eye icon) to open the detail panel.", "Panel shows sections such as Grundlæggende, Kategorisering, SEO, Datoer with correct data; 'Åbn offentlig side' opens the public page.", "low"),
 ("Table: bulk actions - any /cms list", "Select several rows", "Tick several rows. Try 'Slet valgte' and, where shown, 'Genopret valgte', 'Fremhæv valgte', 'Omskriv valgte'.", "Actions apply only to the ticked rows, ask for confirmation and report how many were changed.", "high"),
 ("Table: grid view - lists with a view switch", "List and grid view", "Switch between 'Listevisning' and 'Gittervisning'.", "Same records in both views, nothing lost when switching.", "low"),
 ("Media picker - inside forms with images", "Choose an image", "Open the image field, search the media library, pick one, upload a new one.", "The picked image shows in the form preview and on the public page after saving.", "high"),
 ("Edit lock - Nyheder", "Two editors on one article", "Open the same article in two browsers as two users.", "The second user sees a lock warning and cannot overwrite the first user's work.", "medium"),
]:
    add("CMS admin", page, what, steps, exp, pr)

# ---- background and API
for t, st, ex, pr in P.BACKGROUND: add("Background & API", "Background jobs, integrations and API", t, st, ex, pr)

# ---- ids
counters = {"Public website": ("W", 0), "CMS admin": ("A", 0), "Every page": ("E", 0), "Background & API": ("B", 0)}
n = {k: 0 for k in counters}
for it in items:
    if "id" in it: continue
    pre = counters[it["area"]][0]; n[it["area"]] += 1
    it["id"] = f"{pre}-{n[it['area']]:03d}"
order = {"Automated checks": 0, "Quick test": 1, "Public website": 2, "CMS admin": 3, "Every page": 4, "Background & API": 5}
items.sort(key=lambda i: (order[i["area"]], i["id"]))
out = os.path.join(os.path.dirname(HERE), "seed", "full-checklist.json")
json.dump({"version": 2, "generatedFrom": "Lokalnyt source code", "items": items}, open(out, "w", encoding="utf8"), ensure_ascii=False, indent=1)
from collections import Counter
print(out); print(len(items), dict(Counter(i["area"] for i in items)))
