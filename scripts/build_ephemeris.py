#!/usr/bin/env python3
"""Build mercury/data/vsop87.json: a trimmed VSOP87 for the browser.

The retrogrades table answers "when", but two things on the page move with the
clock and with the date the reader picks: the position of Earth and Mercury
around the Sun, and the geocentric longitude that decides whether Mercury looks
retrograde. Both need an ephemeris in the browser, and a browser cannot run the
full VSOP87 series (thousands of terms per body).

So the series are trimmed here: every term below the threshold is dropped, and
the trimmed table is checked against the full theory before it is written. With
the threshold at 100 (units of 1e-8 rad, so 1e-6 rad) the heliocentric
longitude stays inside a few arcseconds over 1925-2075, which is more than the
page needs: the station instants still come from the exact table.

Usage
-----
    pip install -r requirements-mercury.txt
    python3 scripts/build_ephemeris.py            # rewrite the data file
    python3 scripts/build_ephemeris.py --check    # fail when the file is stale
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    from pymeeus.Earth import VSOP87_B as EARTH_B
    from pymeeus.Earth import VSOP87_L as EARTH_L
    from pymeeus.Earth import VSOP87_R as EARTH_R
    from pymeeus.Mercury import VSOP87_B as MERCURY_B
    from pymeeus.Mercury import VSOP87_L as MERCURY_L
    from pymeeus.Mercury import VSOP87_R as MERCURY_R
except ImportError:  # pragma: no cover - the message is the point
    sys.exit("PyMeeus is missing. Run: pip install -r requirements-mercury.txt")

REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT = REPO_ROOT / "mercury" / "data" / "vsop87.json"

THRESHOLD = 3        # drop terms under 3e-8 rad (about 0.006 arcsec each)
SAMPLE_EPOCHS = 400  # random instants used to measure the error
J2000 = 2451545.0


def trim(series: list[list[list[float]]], threshold: float) -> list[list[list[float]]]:
    """Drop the small terms and the trailing series that end up empty."""
    trimmed: list[list[list[float]]] = []
    for index, terms in enumerate(series):
        kept = [term for term in terms if abs(term[0]) >= threshold]
        trimmed.append(kept)
    while trimmed and not trimmed[-1]:
        trimmed.pop()
    return trimmed


def pack(series: list[list[list[float]]]) -> list[list[list[float]]]:
    """Round for the file: the precision kept is far above the signal."""
    return [
        [[round(term[0], 4), round(term[1], 11), round(term[2], 11)] for term in terms]
        for terms in series
    ]


def heliocentric_longitude(series: list[list[list[float]]], millennia: float) -> float:
    """Radians, VSOP87 style: sum of A*cos(B + C*T) scaled by T**series index."""
    total = 0.0
    for index, terms in enumerate(series):
        total += sum(term[0] * math.cos(term[1] + term[2] * millennia) for term in terms) * millennia ** index
    return total / 1e8


def geocentric_longitude(mercury, earth, jde: float) -> float:
    """Geometric geocentric ecliptic longitude of Mercury, in degrees."""
    millennia = (jde - J2000) / 365250.0

    def vector(body):
        lon = heliocentric_longitude(body["L"], millennia)
        lat = heliocentric_longitude(body["B"], millennia)
        dist = heliocentric_longitude(body["R"], millennia)  # AU
        return (
            dist * math.cos(lat) * math.cos(lon),
            dist * math.cos(lat) * math.sin(lon),
            dist * math.sin(lat),
        )

    mx, my, mz = vector(mercury)
    ex, ey, ez = vector(earth)
    return math.degrees(math.atan2(my - ey, mx - ex)) % 360.0


def measure(full: dict, trimmed: dict) -> dict:
    """Largest deviation of the trimmed series from the full theory."""
    random.seed(20261108)
    max_helio = 0.0
    max_geo = 0.0
    for _ in range(SAMPLE_EPOCHS):
        jde = random.uniform(J2000 - 30 * 36525, J2000 + 50 * 36525)
        millennia = (jde - J2000) / 365250.0
        for body in ("mercury", "earth"):
            max_helio = max(
                max_helio,
                abs(
                    heliocentric_longitude(full[body]["L"], millennia)
                    - heliocentric_longitude(trimmed[body]["L"], millennia)
                ),
            )
        full_geo = geocentric_longitude(full["mercury"], full["earth"], jde)
        trimmed_geo = geocentric_longitude(trimmed["mercury"], trimmed["earth"], jde)
        difference = abs((full_geo - trimmed_geo + 180.0) % 360.0 - 180.0)
        max_geo = max(max_geo, difference)
    return {
        "max_heliocentric_longitude_arcsec": round(math.degrees(max_helio) * 3600, 2),
        "max_geocentric_longitude_arcsec": round(max_geo * 3600, 2),
    }


def build() -> dict:
    full = {
        "mercury": {"L": MERCURY_L, "B": MERCURY_B, "R": MERCURY_R},
        "earth": {"L": EARTH_L, "B": EARTH_B, "R": EARTH_R},
    }
    trimmed = {
        body: {series: pack(trim(values, THRESHOLD)) for series, values in series_set.items()}
        for body, series_set in full.items()
    }
    return {
        "generated": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "source": "PyMeeus 0.5.12 VSOP87D, heliocentric ecliptic of date",
        "threshold": THRESHOLD,
        "terms": {
            body: {series: sum(len(terms) for terms in values) for series, values in series_set.items()}
            for body, series_set in trimmed.items()
        },
        "error": measure(full, trimmed),
        "bodies": trimmed,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail when the data file is stale")
    arguments = parser.parse_args()

    fresh = build()
    if arguments.check:
        if not OUTPUT.exists():
            print(f"missing {OUTPUT.relative_to(REPO_ROOT)}: run scripts/build_ephemeris.py")
            return 1
        current = json.loads(OUTPUT.read_text())
        if current.get("bodies") != fresh["bodies"]:
            print("ephemeris data is stale: run scripts/build_ephemeris.py")
            return 1
        print(f"ephemeris data ok: {fresh['terms']}")
        return 0

    payload = json.dumps(fresh, separators=(",", ":")) + "\n"
    if OUTPUT.exists():
        current = json.loads(OUTPUT.read_text())
        current["generated"] = fresh["generated"]
        if current == fresh:
            print(f"ephemeris data unchanged: {OUTPUT.stat().st_size} bytes")
            return 0
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(payload)
    print(
        f"ephemeris data written: {OUTPUT.stat().st_size} bytes, "
        f"error {fresh['error']['max_geocentric_longitude_arcsec']} arcsec geocentric"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
