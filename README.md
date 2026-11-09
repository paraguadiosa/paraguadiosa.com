# paraguadiosa.com

Personal site of Evelyn Coronel, served at paraguadiosa.com. The professional half
(bio, CV, tech blog) lives at evecoronel.com.

## Structure

- `index.html`: the home, with the list of writings.
- `writings/`: one page per text, generated from `writings.yaml`.
- `writings.yaml`: source of truth for the metadata of every writing.
- `templates/writing.html`: the page template.
- `scripts/fetch_writings.py`: builds the pages from their sources.
- `style.css`, `theme.js`, `version.js`, `version.json`: the design system, the same
  files and tokens used by evecoronel.com.
- `media/wallpaper/`: the artwork.

## Adding or refreshing a writing

1. Add or edit its entry in `writings.yaml`.
2. `python3 scripts/fetch_writings.py --only SLUG`
3. Add the entry to the list in `index.html`.

Dry run to see what would change without touching files:

    python3 scripts/fetch_writings.py --dry-run

## Tarot

`tarot/index.html` is a static one-card or three-card draw that runs entirely in
the browser. The draw uses a JavaScript port of the TempleOS RNG (same seed, same
cards as Mazo), and the reading is composed word for word from the card notes
written by the author. No model, no backend, no third party API.

The generated data lives in the repo:

- `tarot/data/cards.json`: the 78 notes the page reads.
- `tarot/cards/`: the card images, normalized to 480 x 848 so a spread renders level.
- `tarot/data/rider-waite-es.epub`: the book, built from the same notes in the
  source repo (480px profile, 7.8 MB). Served by the reader at `tarot/leer/`.

Rebuild them from the source of truth (`/home/eve/repos/tarot-rider-waite`):

    python3 scripts/build_tarot.py          # idempotent, one line summary
    python3 scripts/build_tarot.py --check  # fail when the outputs are stale

Run the RNG vectors and the page and data checks, all in one command:

    npm test

Full gate for the tarot page:

    python3 scripts/build_tarot.py --check && npm test

### The reader

`tarot/leer/` is an EPUB reader for the book above. It uses vendored
[foliate-js](https://github.com/johnfactotum/foliate-js) (MIT, no build step, see
`tarot/vendor/foliate/PROVENANCE.md`), keeps the reading position in localStorage
and needs no backend. The spread page links to it.

    node tools/verify-reader.mjs           # static: assets, EPUB, imports, wiring
    node tools/verify-reader-browser.mjs   # browser: renders, paginates, restores
    python3 tools/verify-reader-webkit.py  # WebKit (Safari engine): opens, no download

Two renderers live behind that page. The default is foliate's paginator, which puts each
spine document in an iframe. iOS Safari turns that iframe navigation into a download of the
`.xhtml`, so when no document loads within five seconds the reader switches to
`tarot/leer/simple.js`: same EPUB, read with the same zip reader, each document cloned into a
shadow root, native scrolling, no iframe. `?simple=1` forces that renderer for testing.

The browser check expects a static server on `http://127.0.0.1:8765`
(`python3 -m http.server 8765`) and playwright installed outside the repo. It is
not part of `npm test` on purpose: the repo has no runtime dependencies. The
WebKit check needs `webkit2gtk4.1` and `python3-gobject`, and is the only one
that exercises the engine Safari uses.

## Where the text comes from

The texts were migrated out of Google Docs on 2026-10-04: the old site served redirect
stubs to published documents. Every entry in `writings.yaml` keeps the id of its source,
so a text can be re-fetched later.

## Version stamp

Same mechanism as evecoronel.com. `version.json` holds the date of the last commit and
the short hash, `version.js` prints them on the home and hides the line when the file is
not reachable, and `gen-version.sh` regenerates it. A pre-commit hook runs it, so every
commit ships a fresh stamp:

    ln -s ../../.githooks/pre-commit .git/hooks/pre-commit

## Theme

Dark is the default, lavender is the personal accent, light mode inverts the surface
tokens. The toggle stores the choice in localStorage.

## Mercury retrogrades

`mercury/` answers one question: is Mercury retrograde now, and when does the next
window open. It is a static page: the browser compares the current date against a
table and renders the countdown, no model, no backend, no third party API.

The table is generated here and committed:

- `mercury/data/retrograde.json`: every retrograde window from 2020 to 2040, with
  both stations, the sign and degree of each, and the shadow period.

Rebuild it when the range has to grow:

    python3 -m venv ~/.venvs/mercury-build
    ~/.venvs/mercury-build/bin/pip install -r requirements-mercury.txt
    python3 scripts/build_mercury.py           # rewrite the data file
    python3 scripts/build_mercury.py --check   # fail when the file is stale

The method is the apparent geocentric ecliptic longitude of Mercury (PyMeeus 0.5.12,
VSOP87 with light time and aberration), sampled every half day; a window opens where
the daily rate turns negative and closes at the next turn, both stations refined by
bisection. The gate vector is in `tests/mercury-data.test.mjs`: the three 2025 windows
and their station degrees, against the published ephemerides.

A full rebuild takes about four minutes.

### Any date, and the sky

The page also answers for a date the reader picks, and draws Earth and Mercury
around the Sun with Aries at zero. That needs positions in the browser, so a
second table carries a trimmed VSOP87:

- `mercury/data/vsop87.json`: heliocentric longitude, latitude and radius for
  Earth and Mercury, about 800 terms in 34 KB.
- `mercury/ephemeris.js`: evaluates the series, applies light time, and returns
  the geocentric longitude whose rate decides retrograde.

Rebuild and check it with:

    python3 scripts/build_ephemeris.py           # rewrite the data file
    python3 scripts/build_ephemeris.py --check   # fail when the file is stale

The trimming drops every term under 3e-8 rad and the build measures the result
against the full theory: 8.4 arcsec in geocentric longitude over 1925-2075. The
station instants still come from `retrograde.json`, so the table stays exact and
the ephemeris only draws and answers outside 2020-2040, where the page says so.

`tests/mercury-ephemeris.test.mjs` closes the loop: it checks the trimmed series
against baked PyMeeus longitudes and against all 132 stations of the table.

Under the picker a scrubber walks up to a month either side of the chosen date
without moving it, and a Play button walks that month on its own, one day every
170 ms. The sky follows: the marker on the ring sits at the geocentric longitude
that the answer quotes, and a fourteen day trail with an arrowhead shows the way
it is moving, so the retrograde reads as the dot stalling and going back.

The whole page is verified in a real browser with
`node tools/verify-mercury.mjs [base-url]` (needs playwright, same as the reader
tools).
