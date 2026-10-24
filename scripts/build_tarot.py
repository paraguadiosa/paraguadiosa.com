#!/usr/bin/env python3
"""Build the static tarot assets from the Rider-Waite source notes.

Reads the card notes and images from the source repo (read only) and writes
two committed outputs into the site:

    tarot/data/cards.json
    tarot/cards/<id>.jpg  (480 x 848, JPEG quality 82)

Standard library plus Pillow. Every card image is normalized to one canvas size
so a spread renders with cards of identical height: the source scans differ by
up to 40 px in height and a row of them looks ragged otherwise. The margin is
filled with the card's own border colour, sampled from the outer ring, so the
padding is invisible.
Idempotent: an output file is replaced only
when its bytes changed. ``--check`` writes nothing and exits non-zero when
any output is missing or stale.
"""

import argparse
import io
import json
import os
import sys
from pathlib import Path

from PIL import Image
from statistics import median

SITE = Path(__file__).resolve().parent.parent
SOURCE = Path(os.environ.get("TAROT_SOURCE", "/home/eve/repos/tarot-rider-waite"))
DATA_PATH = SITE / "tarot" / "data" / "cards.json"
IMAGES_OUT = SITE / "tarot" / "cards"
WIDTH = 480
HEIGHT = 848
QUALITY = 82
SUITS = ("cups", "pentacles", "wands", "swords")


def card_ids(majors, minors):
    """Return all ids in app order: majors first, then each suit by rank."""
    majors_sorted = sorted(
        (cid for cid in majors if cid.startswith("major-")),
        key=lambda cid: int(cid.split("-")[1]),
    )
    ids = list(majors_sorted)
    for suit in SUITS:
        ids.extend(
            sorted(
                (cid for cid in minors if cid.startswith(f"{suit}-")),
                key=lambda cid: int(cid.split("-")[1]),
            )
        )
    return ids


def build_cards(majors, minors):
    """Return the compact array the page consumes, in app order."""
    all_notes = {**majors, **minors}
    cards = []
    for cid in card_ids(majors, minors):
        note = all_notes[cid]
        cards.append(
            {
                "id": cid,
                "name": note["name"],
                "keywords": note["keywords"],
                "upright": note["upright"],
                "reversed": note["reversed"],
                "image": f"cards/{cid}.jpg",
            }
        )
    return cards


def render_json(cards):
    """Serialize the cards array as UTF-8 JSON with a trailing newline."""
    text = json.dumps(cards, ensure_ascii=False, indent=2)
    return (text + "\n").encode("utf-8")


def border_colour(image):
    """Return the median colour of the outer ring, as an RGB tuple."""
    width, height = image.size
    pixels = image.load()
    ring = []
    for x in range(width):
        ring.append(pixels[x, 0])
        ring.append(pixels[x, height - 1])
    for y in range(height):
        ring.append(pixels[0, y])
        ring.append(pixels[width - 1, y])
    return tuple(int(median(channel[i] for channel in ring)) for i in range(3))


def encode_card(src):
    """Normalize one source image to WIDTH x HEIGHT and return its JPEG bytes."""
    with Image.open(src) as image:
        if image.mode != "RGB":
            image = image.convert("RGB")
        width, height = image.size
        if width != WIDTH:
            new_height = round(height * WIDTH / width)
            image = image.resize((WIDTH, new_height), Image.LANCZOS)
        if image.size[1] > HEIGHT:
            new_width = round(image.size[0] * HEIGHT / image.size[1])
            image = image.resize((new_width, HEIGHT), Image.LANCZOS)
        if image.size != (WIDTH, HEIGHT):
            margin = border_colour(image)
            canvas = Image.new("RGB", (WIDTH, HEIGHT), margin)
            left = (WIDTH - image.size[0]) // 2
            top = (HEIGHT - image.size[1]) // 2
            canvas.paste(image, (left, top))
            image = canvas
        buffer = io.BytesIO()
        image.save(buffer, "JPEG", quality=QUALITY)
        return buffer.getvalue()


def read_bytes(path):
    """Return the file bytes, or None when the file is missing."""
    try:
        return path.read_bytes()
    except FileNotFoundError:
        return None


def write_if_changed(path, data):
    """Write data when it differs from the current file. Return True if written."""
    if read_bytes(path) == data:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(data)
    os.replace(temporary, path)
    return True


def build_outputs(check=False):
    """Compute every output and return a summary dict."""
    majors_path = SOURCE / "content" / "majors-es.json"
    minors_path = SOURCE / "content" / "minors-es.json"
    if not majors_path.is_file() or not minors_path.is_file():
        print(f"tarot: source notes not found under {SOURCE}", file=sys.stderr)
        sys.exit(2)

    majors = json.loads(majors_path.read_text(encoding="utf-8"))
    minors = json.loads(minors_path.read_text(encoding="utf-8"))
    cards = build_cards(majors, minors)
    data = render_json(cards)

    images = {}
    for card in cards:
        cid = card["id"]
        src = SOURCE / "assets" / "cards" / f"{cid}.jpg"
        if not src.is_file():
            print(f"tarot: missing source image {src}", file=sys.stderr)
            sys.exit(2)
        images[cid] = encode_card(src)

    return {"cards": cards, "data": data, "images": images}


def compare_outputs(outputs):
    """Return (missing, changed) counts for --check."""
    missing = 0
    changed = 0
    if read_bytes(DATA_PATH) != outputs["data"]:
        if read_bytes(DATA_PATH) is None:
            missing += 1
        else:
            changed += 1
    for cid, data in outputs["images"].items():
        current = read_bytes(IMAGES_OUT / f"{cid}.jpg")
        if current != data:
            if current is None:
                missing += 1
            else:
                changed += 1
    return missing, changed


def main(argv):
    parser = argparse.ArgumentParser(description="Build the tarot assets.")
    parser.add_argument(
        "--check",
        action="store_true",
        help="write nothing and exit non-zero when any output is stale",
    )
    args = parser.parse_args(argv)

    outputs = build_outputs()
    data_size = len(outputs["data"])
    images_size = sum(len(data) for data in outputs["images"].values())
    count = len(outputs["cards"])

    if args.check:
        missing, changed = compare_outputs(outputs)
        if missing or changed:
            print(
                f"tarot: stale ({missing} missing, {changed} changed, "
                f"{count} cards expected)",
                file=sys.stderr,
            )
            sys.exit(1)
        print(
            f"tarot: ok, {count} cards, data {data_size} bytes, "
            f"images {images_size} bytes"
        )
        return

    written = 0
    unchanged = 0
    if write_if_changed(DATA_PATH, outputs["data"]):
        written += 1
    else:
        unchanged += 1
    for cid, data in outputs["images"].items():
        if write_if_changed(IMAGES_OUT / f"{cid}.jpg", data):
            written += 1
        else:
            unchanged += 1
    print(
        f"tarot: {count} cards, data {data_size} bytes, "
        f"images {images_size} bytes, {written} written, {unchanged} unchanged"
    )


if __name__ == "__main__":
    main(sys.argv[1:])
