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

Rebuild them from the source of truth (`/home/eve/repos/tarot-rider-waite`):

    python3 scripts/build_tarot.py          # idempotent, one line summary
    python3 scripts/build_tarot.py --check  # fail when the outputs are stale

Run the RNG vectors and the page and data checks, all in one command:

    npm test

Full gate for the tarot page:

    python3 scripts/build_tarot.py --check && npm test

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
