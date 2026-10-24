#!/usr/bin/env python3
"""Open the reader in WebKit, the engine Safari uses, and report what happened.

Chromium is not enough for this page: the paginator hands every spine document
to an iframe as a blob, and Safari is the engine that reacts differently to it.
This walks the same path with WebKit2GTK and fails when the book does not load
or when the engine starts a download instead of rendering.

Needs WebKit2GTK 4.1 and PyGObject (Fedora: `webkit2gtk4.1`, `python3-gobject`):

    python3 tools/verify-reader-webkit.py http://127.0.0.1:8765/tarot/leer/

Exit code 0 when the book opens, no download starts and no script error fires.
"""

import json
import sys

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import GLib, Gtk, WebKit2  # noqa: E402

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765/tarot/leer/"
SETTLE_MS = 8000
TIMEOUT_MS = 45000
IPHONE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
)

downloads = []
report = {}

window = Gtk.Window()
window.set_default_size(1280, 900)
view = WebKit2.WebView()
window.add(view)
window.show_all()


def on_download(_context, download):
    uri = download.get_request().get_uri() or ""
    downloads.append(uri[:120])
    print(f"FAIL download started: {uri[:90]}", flush=True)
    download.cancel()


def on_loaded(_view, task, _data):
    try:
        raw = view.evaluate_javascript_finish(task).to_string()
        report.update(json.loads(raw))
    except Exception as error:  # noqa: BLE001
        report["probe_error"] = str(error)[:200]
    finish()


def finish():
    ok = bool(report.get("has_book")) and not downloads and not report.get("errors")
    print(json.dumps({"url": URL, "downloads": downloads, **report}, indent=2, ensure_ascii=False))
    print("ok 1 - WebKit opened the book" if report.get("has_book") else "FAIL the book did not open")
    print(f"ok 2 - no download started ({len(downloads)} seen)" if not downloads
          else f"FAIL {len(downloads)} download(s) started")
    print("ok 3 - no script error" if not report.get("errors")
          else f"FAIL script errors: {report['errors']}")
    print("\n3 checks passed" if ok else "\nfailed")
    Gtk.main_quit()


def probe():
    view.evaluate_javascript(
        "window.__probe = null;"
        "(async () => {"
        "  const v = document.querySelector('foliate-view');"
        "  window.__probe = JSON.stringify({"
        "    has_book: !!(v && v.book),"
        "    upgraded: !!customElements.get('foliate-view'),"
        "    pct: document.querySelector('#reader-pct')?.textContent ?? null,"
        "    status: document.querySelector('#reader-status')?.textContent ?? null,"
        "    status_hidden: document.querySelector('#reader-status')?.hidden ?? null,"
        "    errors: window.__errors || [],"
        "  });"
        "})();",
        -1, None, None, None, lambda *_args: None, None)
    GLib.timeout_add(3000, lambda: (
        view.evaluate_javascript("(window.__probe || '{}')", -1, None, None, None,
                                 on_loaded, None), False)[1])


def on_load_changed(_view, event):
    if event == WebKit2.LoadEvent.FINISHED:
        GLib.timeout_add(SETTLE_MS, lambda: (probe(), False)[1])


context = view.get_context()
context.connect("download-started", on_download)
view.connect("load-changed", on_load_changed)

settings = view.get_settings()
settings.set_user_agent(IPHONE_UA)
settings.set_enable_page_cache(False)

manager = view.get_user_content_manager()
manager.add_script(WebKit2.UserScript.new(
    "window.__errors=[];"
    "window.addEventListener('error',e=>window.__errors.push("
    "  (e.message||'')+' @ '+(e.filename||'')+':'+(e.lineno||'')));"
    "window.addEventListener('unhandledrejection',e=>"
    "  window.__errors.push('rejection: '+String(e.reason)));",
    WebKit2.UserContentInjectedFrames.TOP_FRAME,
    WebKit2.UserScriptInjectionTime.START, None, None))

GLib.timeout_add(TIMEOUT_MS, lambda: (print("FAIL timeout"), Gtk.main_quit(), False)[-1])
view.load_uri(URL)
Gtk.main()
sys.exit(0 if (report.get("has_book") and not downloads and not report.get("errors")) else 1)
