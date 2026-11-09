// mercury-data.test.mjs
// Node-only checks for the static retrogrades page. No dependencies.
// Run with: npm test  (or: node --test 'tests/**/*.test.mjs')
//
// The page itself only compares dates, so what needs a gate is the table the
// generator produced: shape, ordering, plausible durations, and the three 2025
// windows that published ephemerides already pin down.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(SITE_ROOT, "mercury", "data", "retrograde.json");
const PAGE = path.join(SITE_ROOT, "mercury", "index.html");

const load = () => JSON.parse(readFileSync(DATA, "utf8"));
const at = (iso) => new Date(iso).getTime();
const windows = load().windows;

test("the data file is committed, the generator output is not assumed", () => {
    assert.ok(existsSync(DATA), "mercury/data/retrograde.json is missing");
    assert.ok(existsSync(PAGE), "mercury/index.html is missing");
});

test("the table covers the years the page claims", () => {
    const payload = load();
    assert.equal(payload.first_year, 2020);
    assert.equal(payload.last_year, 2040);
    const firstYear = new Date(windows[0].start).getUTCFullYear();
    const lastYear = new Date(windows.at(-1).start).getUTCFullYear();
    assert.equal(firstYear, 2020);
    assert.equal(lastYear, 2040);
});

test("every window is well formed: start, end, stations, shadow", () => {
    for (const window of windows) {
        assert.ok(at(window.end) > at(window.start), `${window.start} ends before it starts`);
        assert.ok(window.retrograde.sign && window.direct.sign, "missing a sign");
        assert.ok(window.retrograde.degree >= 0 && window.retrograde.degree < 30);
        assert.ok(window.direct.degree >= 0 && window.direct.degree < 30);
        assert.ok(at(window.shadow_start) < at(window.start), "shadow must open before the station");
        assert.ok(at(window.shadow_end) > at(window.end), "shadow must close after the station");
    }
});

test("retrograde windows never overlap and stay 15 to 30 days long", () => {
    for (let index = 1; index < windows.length; index += 1) {
        assert.ok(at(windows[index].start) > at(windows[index - 1].end), "windows overlap");
    }
    for (const window of windows) {
        assert.ok(window.days >= 15 && window.days <= 30, `${window.start} lasts ${window.days} days`);
        const measured = (at(window.end) - at(window.start)) / 86400000;
        assert.ok(Math.abs(measured - window.days) < 0.02, `${window.start} duration disagrees with its dates`);
    }
});

test("three windows a year, five or six months apart", () => {
    const byYear = new Map();
    for (const window of windows) {
        const year = new Date(window.start).getUTCFullYear();
        byYear.set(year, (byYear.get(year) ?? 0) + 1);
    }
    for (const [year, count] of byYear) {
        assert.ok(count === 3 || count === 4, `${year} has ${count} windows`);
    }
});

test("gate vector: the 2025 windows match published ephemerides", () => {
    // Published 2025 stations (UTC): 15 Mar 06:45, 7 Apr 11:07, 18 Jul 04:44,
    // 11 Aug 07:28, 9 Nov 18:59, 29 Nov 17:37. Tolerance: one hour, because the
    // published tables round to the minute and disagree by seconds.
    const published = [
        { start: "2025-03-15T06:45", end: "2025-04-07T11:07", retro: 9.58, direct: 26.82 },
        { start: "2025-07-18T04:44", end: "2025-08-11T07:28", retro: 15.57, direct: 4.25 },
        { start: "2025-11-09T18:59", end: "2025-11-29T17:37", retro: 6.86, direct: 20.70 },
    ];
    const hour = 3600000;
    const year2025 = windows.filter((window) => window.start.startsWith("2025"));
    assert.equal(year2025.length, 3);

    published.forEach((expected, index) => {
        const actual = year2025[index];
        assert.ok(
            Math.abs(at(actual.start) - at(expected.start + ":00Z")) < hour,
            `station retrograde ${index}: ${actual.start} vs ${expected.start}`,
        );
        assert.ok(
            Math.abs(at(actual.end) - at(expected.end + ":00Z")) < hour,
            `station direct ${index}: ${actual.end} vs ${expected.end}`,
        );
        // Stations to the arcminute: 0.02 degrees is a bit over one arcminute.
        assert.ok(Math.abs(actual.retrograde.degree - expected.retro) < 0.02, `retrograde degree ${index}`);
        assert.ok(Math.abs(actual.direct.degree - expected.direct) < 0.02, `direct degree ${index}`);
    });
});

test("2025 station degrees land in the signs the ephemerides name", () => {
    const year2025 = windows.filter((window) => window.start.startsWith("2025"));
    assert.deepEqual(
        year2025.map((window) => [window.retrograde.sign, window.direct.sign]),
        [["Aries", "Pisces"], ["Leo", "Leo"], ["Sagittarius", "Scorpio"]],
    );
});

test("the page reads the table with the field names the generator writes", () => {
    const source = readFileSync(path.join(SITE_ROOT, "mercury", "mercury.js"), "utf8");
    for (const field of ["shadow_start", "shadow_end", "first_year", "last_year", "generated"]) {
        assert.ok(source.includes(field), `mercury.js never reads ${field}`);
    }
    assert.ok(source.includes("./data/retrograde.json"), "mercury.js does not fetch the data file");
});
