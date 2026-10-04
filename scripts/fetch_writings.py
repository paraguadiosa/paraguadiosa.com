#!/usr/bin/env python3
"""Build the static writing pages from the content pipeline manifest.

Reads writings.yaml, fetches the source for each entry, renders
templates/writing.html and writes writings/SLUG.html. Standard library only.
"""
import argparse
import hashlib
import html as html_lib
import os
import re
import sys
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OLD_SITE = Path(os.environ.get("ASTRO_SITE", "/home/eve/repos/astrocronopio.github.io"))
MANIFEST_PATH = REPO / "writings.yaml"
TEMPLATE_PATH = REPO / "templates" / "writing.html"
OUT_DIR = REPO / "writings"
INDENT = " " * 16
TIMEOUT = 30

CHROME_MARKERS = (
    "se publicó con documentos", "se publicó con document",
    "publicado con google docs", "published with google docs",
    "denunciar abuso", "report abuse", "más información", "mas información",
    "more information", "learn more", "se actualiza automáticamente",
    "updates automatically",
)
FALLBACK_TEXT = "No se pudo obtener el texto desde la fuente original."

def parse_args(argv):
    parser = argparse.ArgumentParser(description="Build writing pages.")
    parser.add_argument("--dry-run", action="store_true",
                        help="print the plan and counts, write nothing")
    parser.add_argument("--only", metavar="SLUG",
                        help="build a single writing by slug")
    parser.add_argument("--cache", metavar="DIR",
                        help="directory for cached raw downloads")
    return parser.parse_args(argv)

def unquote(value):
    if len(value) >= 2 and value[0] == '"' and value[-1] == '"':
        return value[1:-1]
    return value

def read_manifest(path):
    """Read the flat yaml subset: one block per entry, key: value lines."""
    entries = []
    current = None
    with open(path, encoding="utf-8") as handle:
        for raw in handle:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("-"):
                if current is not None:
                    entries.append(current)
                current = {}
                rest = line[1:].strip()
                if rest:
                    key, _, value = rest.partition(":")
                    current[key.strip()] = unquote(value.strip())
                continue
            key, _, value = line.partition(":")
            if key.strip():
                current[key.strip()] = unquote(value.strip())
    if current is not None:
        entries.append(current)
    for entry in entries:
        entry["warning"] = entry.get("warning", "").strip().lower() == "true"
        entry["listed"] = entry.get("listed", "").strip().lower() == "true"
        entry["notes"] = entry.get("notes", "")
        entry["date"] = entry.get("date", "")
    return entries

def source_url(entry):
    kind = entry["kind"]
    source = entry["source"]
    if kind == "gdoc":
        return "https://docs.google.com/document/d/e/{}/pub".format(source)
    if kind == "pastebin":
        return "https://pastebin.com/raw/{}".format(source)
    return source

def normalize(text):
    text = html_lib.unescape(text)
    text = text.replace("\xa0", " ")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]
    return "\n".join(lines).strip()

def fragment_to_text(fragment):
    fragment = re.sub(r"<br\s*/?>", "\n", fragment, flags=re.I)
    fragment = re.sub(r"<[^>]+>", "", fragment)
    return normalize(fragment)

def is_chrome(text):
    low = text.lower()
    return any(marker in low for marker in CHROME_MARKERS)

def paragraphs_from_html(inner_html):
    paragraphs = []
    for fragment in re.findall(r"<p[^>]*>(.*?)</p>", inner_html, re.S):
        text = fragment_to_text(fragment)
        if text and not is_chrome(text):
            paragraphs.append(text)
    return paragraphs

def gdoc_paragraphs(document_html):
    match = re.search(
        r'<div[^>]*class="[^"]*doc-content[^"]*"[^>]*>(.*?)</div>',
        document_html, re.S)
    if not match:
        raise ValueError("doc-content div not found")
    return paragraphs_from_html(match.group(1))

def local_paragraphs(page_html):
    match = re.search(
        r'<div[^>]*class="[^"]*writing-body[^"]*"[^>]*>(.*?)</div>',
        page_html, re.S)
    if not match:
        raise ValueError("writing-body div not found")
    return paragraphs_from_html(match.group(1))

def pastebin_paragraphs(text):
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    paragraphs = []
    for block in re.split(r"\n[ \t]*\n", text):
        cleaned = normalize(block)
        if cleaned:
            paragraphs.append(cleaned)
    return paragraphs

def fetch_bytes(url, cache_dir, write_cache):
    cache_path = None
    if cache_dir:
        key = hashlib.sha1(url.encode("utf-8")).hexdigest() + ".raw"
        cache_path = Path(cache_dir) / key
        if cache_path.exists():
            return cache_path.read_bytes()
    request = urllib.request.Request(
        url, headers={"User-Agent": "content-pipeline/1.0"})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        data = response.read()
    if cache_path and write_cache:
        Path(cache_dir).mkdir(parents=True, exist_ok=True)
        cache_path.write_bytes(data)
    return data

def inner_html(paragraph):
    escaped = html_lib.escape(paragraph, quote=False)
    return escaped.replace("\n", "<br>")

def gather_paragraphs(entry, cache_dir, write_cache):
    kind = entry["kind"]
    if kind == "external":
        url = source_url(entry)
        notes = entry.get("notes") or url
        link = '<a href="{0}">{1}</a>'.format(
            html_lib.escape(url, quote=True),
            html_lib.escape(notes, quote=False))
        return [link], notes
    if kind == "local":
        text = (OLD_SITE / entry["source"]).read_text(
            encoding="utf-8", errors="replace")
        paragraphs = local_paragraphs(text)
    else:
        raw = fetch_bytes(source_url(entry), cache_dir, write_cache)
        text = raw.decode("utf-8", errors="replace")
        if kind == "gdoc":
            paragraphs = gdoc_paragraphs(text)
        else:
            paragraphs = pastebin_paragraphs(text)
    plain = " ".join(paragraphs)
    return [inner_html(p) for p in paragraphs], plain

def fallback_inner(entry):
    url = source_url(entry)
    return '{0} <a href="{1}">{1}</a>'.format(
        FALLBACK_TEXT, html_lib.escape(url, quote=True))

def render_page(template, entry, inner_paragraphs):
    title = html_lib.escape(entry["title"], quote=False)
    date = entry.get("date") or ""
    meta = ""
    if date:
        meta = INDENT + '<p class="writing-meta">{}</p>'.format(
            html_lib.escape(date, quote=False))
    body_lines = [INDENT + "<p>{}</p>".format(inner) for inner in inner_paragraphs]
    body = "\n\n".join(body_lines)
    page = template.replace("{{TITLE}}", title)
    page = page.replace("{{META}}", meta)
    page = page.replace("{{BODY}}", body)
    return page

def word_count(text):
    return len(text.split())

def main(argv):
    args = parse_args(argv)
    template = TEMPLATE_PATH.read_text(encoding="utf-8")
    entries = read_manifest(MANIFEST_PATH)
    if args.only:
        entries = [e for e in entries if e["slug"] == args.only]
        if not entries:
            print("unknown slug: {}".format(args.only), file=sys.stderr)
            return 1
    if args.cache and not args.dry_run:
        Path(args.cache).mkdir(parents=True, exist_ok=True)
    write_cache = not args.dry_run
    totals = {"ok": 0, "failed": 0, "paragraphs": 0, "words": 0}
    for entry in entries:
        ok = True
        plain = ""
        try:
            inner_paragraphs, plain = gather_paragraphs(
                entry, args.cache, write_cache)
        except Exception as exc:
            ok = False
            inner_paragraphs = [fallback_inner(entry)]
            plain = FALLBACK_TEXT
            print("warn: {} source failed: {}".format(entry["slug"], exc),
                  file=sys.stderr)
        words = word_count(plain)
        out_path = OUT_DIR / "{}.html".format(entry["slug"])
        page = render_page(template, entry, inner_paragraphs)
        status = "ok" if ok else "source-failed"
        print("{} {} paragraphs={} words={} {} {}".format(
            entry["slug"], entry["kind"], len(inner_paragraphs), words,
            out_path, status))
        if not args.dry_run:
            OUT_DIR.mkdir(exist_ok=True)
            out_path.write_text(page, encoding="utf-8")
        if ok:
            totals["ok"] += 1
        else:
            totals["failed"] += 1
        totals["paragraphs"] += len(inner_paragraphs)
        totals["words"] += words
    print("total entries={} ok={} failed={} paragraphs={} words={} dry_run={}".format(
        len(entries), totals["ok"], totals["failed"],
        totals["paragraphs"], totals["words"], args.dry_run))
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
