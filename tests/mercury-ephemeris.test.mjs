// mercury-ephemeris.test.mjs
// Node-only checks for the browser ephemeris and the date picker behind it.
// Run with: npm test  (or: node --test 'tests/**/*.test.mjs')
//
// The trimmed VSOP87 is only useful if it agrees with the full theory, so the
// gate here is comparison: against baked reference longitudes from PyMeeus, and
// against every station in the committed table.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { createEphemeris } from "../mercury/ephemeris.js";

const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (relative) => JSON.parse(readFileSync(path.join(SITE_ROOT, relative), "utf8"));

const table = readJson("mercury/data/vsop87.json");
const retrogrades = readJson("mercury/data/retrograde.json");
const ephemeris = createEphemeris(table);
const windows = retrogrades.windows;

const SIGNS = [
    "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
    "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces",
];

const absolute = (station) => SIGNS.indexOf(station.sign) * 30 + station.degree;

function arcBetween(left, right) {
    const difference = Math.abs(left - right) % 360;
    return difference > 180 ? 360 - difference : difference;
}

test("the trimmed series stayed inside the error it advertises", () => {
    assert.equal(table.error.max_geocentric_longitude_arcsec < 60, true,
        `trimmed series drift ${table.error.max_geocentric_longitude_arcsec} arcsec`);
    for (const body of ["mercury", "earth"]) {
        for (const series of ["L", "B", "R"]) {
            assert.equal(Array.isArray(table.bodies[body][series]), true, `${body}.${series} missing`);
        }
    }
});

test("geocentric longitude matches PyMeeus at six dates spread over a century", () => {
    // Reference values computed with pymeeus 0.5.12 at 00:00 UTC (apparent
    // longitude, no aberration term on our side: 0.02 degrees of slack).
    const references = [
        ["1980-03-03T00:00:00Z", 348.8420],
        ["2000-01-01T00:00:00Z", 271.1155],
        ["2026-11-08T00:00:00Z", 218.0712],
        ["2030-06-01T00:00:00Z", 48.1449],
        ["2055-01-15T00:00:00Z", 308.3656],
        ["2070-09-09T00:00:00Z", 149.0613],
    ];
    for (const [iso, expected] of references) {
        const measured = ephemeris.geocentric(new Date(iso)).longitude;
        assert.ok(arcBetween(measured, expected) < 0.02,
            `${iso}: ${measured.toFixed(4)} vs ${expected}`);
    }
});

test("every station in the table lands where the browser ephemeris puts Mercury", () => {
    let worst = 0;
    for (const window of windows) {
        for (const [moment, station] of [[window.start, window.retrograde], [window.end, window.direct]]) {
            const measured = ephemeris.geocentric(new Date(moment)).longitude;
            const gap = arcBetween(measured, absolute(station));
            worst = Math.max(worst, gap);
            assert.ok(gap < 0.02, `${moment}: ${measured.toFixed(4)} vs ${absolute(station).toFixed(2)}`);
        }
    }
    assert.ok(worst < 0.02, `worst station gap ${worst}`);
});

test("the motion sign flips exactly across each window", () => {
    for (const window of windows.slice(0, 12)) {
        const start = new Date(window.start).getTime();
        const end = new Date(window.end).getTime();
        const middle = new Date((start + end) / 2);
        assert.ok(ephemeris.motion(middle) < 0, `${window.start}: not retrograde inside`);
        assert.ok(ephemeris.motion(new Date(start - 6 * 86400000)) > 0, `${window.start}: retrograde six days before`);
        assert.ok(ephemeris.motion(new Date(end + 6 * 86400000)) > 0, `${window.end}: retrograde six days after`);
    }
});

test("outside the table the ephemeris still places the stations", () => {
    // PyMeeus puts the 2055 window at 12 Jan 21:39 and 2 Feb 12:25 UTC.
    const stations = ephemeris.nearestStations(new Date("2055-01-15T00:00:00Z"));
    assert.equal(stations.retrograde, true);
    assert.ok(Math.abs(new Date(stations.previous).getTime() - Date.parse("2055-01-12T21:39:00Z")) < 86400000,
        `start ${stations.previous.toISOString()}`);
    assert.ok(Math.abs(new Date(stations.next).getTime() - Date.parse("2055-02-02T12:25:00Z")) < 86400000,
        `end ${stations.next.toISOString()}`);
});

test("outside the table on a direct date, the next window is ahead", () => {
    const stations = ephemeris.nearestStations(new Date("2056-06-01T00:00:00Z"));
    assert.equal(stations.retrograde, false);
    assert.ok(new Date(stations.next) > new Date("2056-06-01T00:00:00Z"));
    assert.ok(new Date(stations.previous) < new Date("2056-06-01T00:00:00Z"));
});
