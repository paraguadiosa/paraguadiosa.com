# foliate-js (vendored)

Source: https://github.com/johnfactotum/foliate-js
Vendored: 2026-10-24, commit copied as-is (no local edits).
License: MIT (see LICENSE).

Only the files the EPUB reader needs are included:

    view.js epub.js epubcfi.js paginator.js overlayer.js
    progress.js text-walker.js fixed-layout.js
    vendor/zip.js vendor/fflate.js

pdf.js, mobi.js, comic-book.js, fb2.js, search.js and tts.js are NOT vendored:
view.js loads them with dynamic imports, and this reader only opens EPUB files.

To update: copy the same files from a newer upstream checkout and re-run
`node --test tests/tarot-reader-static.test.mjs`.
