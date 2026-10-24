// tools/verify-reader.mjs
// Static checks for the tarot EPUB reader: the committed EPUB, the vendored
// foliate-js files and the page wiring. No browser needed, no dependencies.
// Run with: node tools/verify-reader.mjs   (or: npm run verify:reader)

import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rel = (p) => path.join(ROOT, p);
const read = (p) => readFileSync(rel(p), "utf8");

const VENDOR = [
    "tarot/vendor/foliate/view.js",
    "tarot/vendor/foliate/epub.js",
    "tarot/vendor/foliate/epubcfi.js",
    "tarot/vendor/foliate/paginator.js",
    "tarot/vendor/foliate/overlayer.js",
    "tarot/vendor/foliate/progress.js",
    "tarot/vendor/foliate/text-walker.js",
    "tarot/vendor/foliate/fixed-layout.js",
    "tarot/vendor/foliate/vendor/zip.js",
    "tarot/vendor/foliate/vendor/fflate.js",
    "tarot/vendor/foliate/LICENSE",
    "tarot/vendor/foliate/PROVENANCE.md",
];

const EPUB = "tarot/data/rider-waite-es.epub";
const SIMPLE = "tarot/leer/simple.js";
const PAGE = "tarot/leer/index.html";
const SCRIPT = "tarot/leer/reader.js";

let checks = 0;
const ok = (label) => {
    checks += 1;
    console.log(`ok ${checks} - ${label}`);
};

// 1. The reader page and its assets exist.
for (const file of [PAGE, SCRIPT, SIMPLE, "tarot/leer/reader.css", EPUB, ...VENDOR]) {
    assert.ok(existsSync(rel(file)), `missing ${file}`);
    ok(`${file} exists`);
}

// 2. The EPUB is a real zip with an OPF, and small enough to ship on Pages.
const epubBytes = readFileSync(rel(EPUB));
assert.equal(epubBytes.subarray(0, 2).toString("latin1"), "PK", "EPUB is not a zip");
ok("EPUB starts with the ZIP magic bytes");
const epubSize = statSync(rel(EPUB)).size;
assert.ok(epubSize < 12 * 1024 * 1024, `EPUB too big for the site: ${epubSize} bytes`);
ok(`EPUB is ${(epubSize / (1024 * 1024)).toFixed(1)} MB`);
assert.ok(epubBytes.includes("mimetype"), "EPUB has no mimetype entry");
ok("EPUB carries a mimetype entry");

// 3. Every relative import inside the vendored files resolves on disk, except
//    the format/search modules that view.js loads lazily and this reader never
//    reaches (it only opens EPUB files). See PROVENANCE.md.
const OPTIONAL = new Set([
    "./comic-book.js",
    "./fb2.js",
    "./pdf.js",
    "./mobi.js",
    "./search.js",
    "./tts.js",
]);
const importRe = /from\s+["'](\.\.?\/[^"']+)["']|import\(\s*["'](\.\.?\/[^"']+)["']\s*\)/g;
let importCount = 0;
for (const file of VENDOR.filter((f) => f.endsWith(".js"))) {
    const source = read(file);
    for (const match of source.matchAll(importRe)) {
        const spec = match[1] ?? match[2];
        if (OPTIONAL.has(spec)) continue;
        const target = path.join(path.dirname(rel(file)), spec);
        importCount += 1;
        assert.ok(existsSync(target), `${file} imports missing ${spec}`);
    }
}
ok(`${importCount} relative imports inside the vendored files resolve`);

// 4. The page wires the reader: custom element, module script, stylesheet.
const page = read(PAGE);
assert.match(page, /<foliate-view[^>]*id="reader-view"/, "page has no foliate-view element");
assert.match(page, /<script type="module" src="\.\/reader\.js">/, "page does not load reader.js as a module");
assert.match(page, /reader\.css/, "page does not load reader.css");
assert.match(page, /href="\.\.\/index\.html"/, "page has no way back to the spread");
assert.match(
    page,
    /window\.addEventListener\("error"[\s\S]{0,400}reader-status/,
    "page has no visible error handler for a failed load",
);
ok("reader page has the viewer, the module script, the way back and an error slot");

// 5. The script opens the committed EPUB and keeps the position.
const script = read(SCRIPT);
assert.match(script, /rider-waite-es\.epub/, "reader.js does not open the committed EPUB");
assert.match(script, /tarot-reader-cfi/, "reader.js does not persist the reading position");
assert.match(script, /goRight/, "reader.js has no forward navigation");
assert.match(script, /goLeft/, "reader.js has no backward navigation");
ok("reader.js opens the EPUB, navigates both ways and stores the CFI");

// 6. iOS: spine documents are handed to the iframe as text/html. A blob typed
//    application/xhtml+xml makes Safari download the file instead of showing it.
assert.match(script, /application\/xhtml\+xml/, "reader.js has no XHTML type shim");
assert.match(script, /event\.detail\.type = "text\/html"/, "the shim does not rewrite the blob type");
assert.match(script, /documentsAsHTML\(view\.book\)/, "the shim is defined but never installed");
ok("XHTML documents are served to the paginator as text/html");

// 7. Navigation stays off until the book is open: foliate reads this.book in
//    goLeft/goRight, and this.book only exists after open() resolves.
assert.match(script, /let ready = false/, "reader.js has no readiness flag");
assert.match(script, /if \(!ready\) return;/, "the navigation handlers do not check readiness");
assert.match(script, /setControls\(true\)/, "the controls are never enabled after loading");
assert.match(page, /id="reader-next"[^>]*disabled/, "the next button starts enabled in the markup");
ok("navigation is disabled until the book is open");

// 8. The iframe-free renderer exists and is reachable from the reader.
const simple = read(SIMPLE);
assert.match(simple, /from "\.\.\/vendor\/foliate\/vendor\/zip\.js"/, "simple.js does not reuse the vendored zip reader");
assert.match(simple, /attachShadow\(\{ mode: "open" \}\)/, "simple.js does not isolate the book styles");
assert.match(script, /await import\("\.\/simple\.js"\)/, "reader.js never loads the fallback");
assert.match(script, /FALLBACK_MS/, "reader.js has no fallback timer");
assert.match(read("tarot/leer/reader.css"), /\.reader-simple/, "no styles for the fallback surface");
ok("the iframe-free renderer is wired as a fallback");

// 9. The spread page links to the reader.
const spread = read("tarot/index.html");
assert.match(spread, /href="\.\/leer\/index\.html"/, "tarot page does not link to the reader");
ok("tarot page links to the reader");

// 10. House style: no em dashes in the new files.
for (const file of [PAGE, SCRIPT, SIMPLE, "tarot/leer/reader.css", "tarot/vendor/foliate/PROVENANCE.md"]) {
    const text = read(file);
    assert.ok(!text.includes("\u2014"), `${file} contains an em dash`);
}
ok("no em dashes in the new files");

console.log(`\n${checks} checks passed`);
