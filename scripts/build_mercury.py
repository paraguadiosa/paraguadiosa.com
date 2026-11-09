#!/usr/bin/env python3
"""Build mercury/data/retrograde.json: the Mercury retrograde windows.

The page is static, so the ephemeris runs here, once, and the result is
committed. The browser only compares dates against that table.

Method
------
Mercury's apparent geocentric ecliptic longitude is computed with PyMeeus
(VSOP87 truncated series, light-time and aberration included) at 0.5-day
intervals. A retrograde window opens where the daily rate of change flips
from positive to negative (station retrograde) and closes at the next flip
back to positive (station direct). Both stations are then refined by
bisection, so the timestamps land on the minute.

Validation: the 2025 windows come out as 15 Mar, 18 Jul and 9 Nov 2025,
which is what the published ephemerides say, and the station degrees match
to the arcminute (9 deg 35' Aries, 26 deg 50' Pisces).

Usage
-----
    pip install -r requirements-mercury.txt
    python3 scripts/build_mercury.py            # rewrite the data file
    python3 scripts/build_mercury.py --check    # fail when the file is stale

Idempotent: it prints one line and writes only when the numbers changed.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    from pymeeus.Earth import Earth
    from pymeeus.Epoch import Epoch
    from pymeeus.Mercury import Mercury
except ImportError:  # pragma: no cover - the message is the point
    sys.exit(
        "PyMeeus is missing. Run: pip install -r requirements-mercury.txt"
    )

REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT = REPO_ROOT / "mercury" / "data" / "retrograde.json"

# Window covered by the table. The page degrades gracefully outside it.
FIRST_YEAR = 2020
LAST_YEAR = 2040

SIGNS = [
    "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
    "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces",
]

SAMPLE_STEP = 0.5   # days between rate samples
BISECT_STEPS = 40   # halvings: 0.5 day / 2**40 is far below a second
SCAN_STEP = 0.25    # days, when hunting a shadow crossing
SCAN_LIMIT = 60.0   # days, the search budget for one crossing


def ecliptic_longitude(jde: float) -> float:
    """Apparent geocentric ecliptic longitude of Mercury, in degrees."""
    epoch = Epoch(jde)
    lon_m, lat_m, dist_m = Mercury.apparent_heliocentric_position(epoch)
    lon_e, lat_e, dist_e = Earth.apparent_heliocentric_position(epoch)

    cos_m, cos_e = math.cos(lat_m.rad()), math.cos(lat_e.rad())
    x = dist_m * cos_m * math.cos(lon_m.rad()) - dist_e * cos_e * math.cos(lon_e.rad())
    y = dist_m * cos_m * math.sin(lon_m.rad()) - dist_e * cos_e * math.sin(lon_e.rad())
    return math.degrees(math.atan2(y, x)) % 360.0


def signed_arc(start: float, end: float) -> float:
    """Shortest angular distance from start to end, in (-180, 180]."""
    delta = (end - start) % 360.0
    return delta - 360.0 if delta > 180.0 else delta


def daily_rate(jde: float) -> float:
    """Degrees of longitude per day, centred on the given instant."""
    half = SAMPLE_STEP / 2.0
    return signed_arc(ecliptic_longitude(jde - half), ecliptic_longitude(jde + half)) / SAMPLE_STEP


def refine_station(low: float, high: float) -> float:
    """Bisect a rate sign change down to the second."""
    low_positive = daily_rate(low) > 0.0
    for _ in range(BISECT_STEPS):
        middle = (low + high) / 2.0
        if (daily_rate(middle) > 0.0) == low_positive:
            low = middle
        else:
            high = middle
    return (low + high) / 2.0


def jde_to_utc(jde: float) -> datetime:
    year, month, day, hour, minute, second = Epoch(jde).get_full_date()
    whole_seconds = int(second)
    moment = datetime(
        year, month, day, hour, minute, whole_seconds, tzinfo=timezone.utc
    )
    # Round to the minute: the page never shows seconds.
    return moment + timedelta(seconds=round(second - whole_seconds))


def sign_of(longitude: float) -> tuple[str, float]:
    index = int(longitude // 30) % 12
    return SIGNS[index], longitude % 30.0


def find_crossing(start_jde: float, target: float, direction: int) -> float | None:
    """Nearest direct crossing of `target` before (direction -1) or after (+1).

    Mercury passes the same degree three times around one retrograde: direct,
    backwards, and direct again. The shadow ends are the direct crossings, so
    the search skips anything that happens while the longitude is decreasing.
    """
    step = SCAN_STEP * direction
    previous_jde = start_jde
    previous_delta = signed_arc(target, ecliptic_longitude(start_jde))
    for index in range(1, int(SCAN_LIMIT / SCAN_STEP) + 1):
        jde = start_jde + step * index
        delta = signed_arc(target, ecliptic_longitude(jde))
        crossed = (
            previous_delta < 0.0 <= delta if direction > 0
            else delta <= 0.0 < previous_delta
        )
        if crossed and daily_rate(jde) > 0.0:
            low, high = sorted((previous_jde, jde))
            for _ in range(BISECT_STEPS):
                middle = (low + high) / 2.0
                middle_delta = signed_arc(target, ecliptic_longitude(middle))
                before = middle_delta < 0.0 if direction > 0 else middle_delta > 0.0
                if before:
                    low = middle
                else:
                    high = middle
            return (low + high) / 2.0
        previous_jde, previous_delta = jde, delta
    return None


def collect_windows() -> list[dict]:
    """Walk the whole range and return every retrograde window, oldest first."""
    cursor = Epoch(FIRST_YEAR, 1, 1.0).jde()
    end = Epoch(LAST_YEAR + 1, 1, 1.0).jde()
    windows: list[dict] = []
    open_station: dict | None = None
    previous_rate = daily_rate(cursor)

    while cursor < end:
        cursor += SAMPLE_STEP
        rate = daily_rate(cursor)
        if previous_rate * rate < 0.0:
            station = refine_station(cursor - SAMPLE_STEP, cursor)
            longitude = ecliptic_longitude(station)
            if rate < 0.0 and open_station is None:
                open_station = {"jde": station, "longitude": longitude}
            elif rate > 0.0 and open_station is not None:
                retro_jde = open_station["jde"]
                retro_lon = open_station["longitude"]
                windows.append(
                    {
                        "start": jde_to_utc(retro_jde).isoformat().replace("+00:00", "Z"),
                        "end": jde_to_utc(station).isoformat().replace("+00:00", "Z"),
                        "retrograde": {"sign": sign_of(retro_lon)[0], "degree": round(sign_of(retro_lon)[1], 2)},
                        "direct": {"sign": sign_of(longitude)[0], "degree": round(sign_of(longitude)[1], 2)},
                        "days": round(station - retro_jde, 2),
                        "shadow_start": _crossing_iso(retro_jde, longitude, -1),
                        "shadow_end": _crossing_iso(station, retro_lon, +1),
                    }
                )
                open_station = None
        previous_rate = rate

    return windows


def _crossing_iso(anchor_jde: float, target: float, direction: int) -> str | None:
    crossing = find_crossing(anchor_jde, target, direction)
    if crossing is None:
        return None
    return jde_to_utc(crossing).isoformat().replace("+00:00", "Z")


def build() -> dict:
    return {
        "generated": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "first_year": FIRST_YEAR,
        "last_year": LAST_YEAR,
        "method": "apparent geocentric ecliptic longitude, PyMeeus 0.5.12 (VSOP87)",
        "windows": collect_windows(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail when the data file is stale")
    arguments = parser.parse_args()

    fresh = build()
    if arguments.check:
        if not OUTPUT.exists():
            print(f"missing {OUTPUT.relative_to(REPO_ROOT)}: run scripts/build_mercury.py")
            return 1
        current = json.loads(OUTPUT.read_text())
        same = [
            {key: value for key, value in window.items()}
            for window in current.get("windows", [])
        ] == fresh["windows"]
        if not same:
            print("data is stale: run scripts/build_mercury.py")
            return 1
        print(f"mercury data ok: {len(fresh['windows'])} windows")
        return 0

    payload = json.dumps(fresh, indent=1, ensure_ascii=False) + "\n"
    if OUTPUT.exists() and OUTPUT.read_text() == payload.replace(fresh["generated"], json.loads(OUTPUT.read_text())["generated"]):
        print(f"mercury data unchanged: {len(fresh['windows'])} windows")
        return 0
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(payload)
    print(
        f"mercury data written: {len(fresh['windows'])} windows, "
        f"{FIRST_YEAR}-{LAST_YEAR} -> {OUTPUT.relative_to(REPO_ROOT)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
