// tools/verify-mercury.mjs
// Browser checks for the retrogrades page. Needs playwright (not a repo
// dependency: run it from a machine that has it, e.g. `npm i -g playwright`).
//
//   node tools/verify-mercury.mjs [base-url]
//
// Default base url is a local static server: python3 -m http.server 8110

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

const BASE = (process.argv[2] ?? "http://127.0.0.1:8110").replace(/\/$/, "");
const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const table = JSON.parse(
    readFileSync(path.join(SITE_ROOT, "mercury", "data", "retrograde.json"), "utf8"),
);
const windows = table.windows.map((window) => ({
    start: new Date(window.start).getTime(),
    end: new Date(window.end).getTime(),
    shadowStart: new Date(window.shadow_start).getTime(),
}));

// The same decision the page makes, computed here so the assertion is not a
// restatement of the page's own output.
function expectedState(now) {
    const current = windows.find((window) => window.start <= now && now <= window.end);
    if (current) return "retro";
    const next = windows.find((window) => window.start > now);
    if (next && now >= next.shadowStart) return "shadow";
    if (next) return "direct";
    return "unknown";
}

const browser = await chromium.launch();
const problems = [];
const failures = [];

async function inspect(width, height, label) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on("console", (message) => {
        if (message.type() === "error") problems.push(`${label} console: ${message.text()}`);
    });
    page.on("pageerror", (error) => problems.push(`${label} pageerror: ${error.message}`));
    page.on("response", (response) => {
        if (response.status() >= 400) problems.push(`${label} ${response.status()} ${response.url()}`);
    });

    await page.goto(`${BASE}/mercury/`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.getElementById("mercury-state").textContent !== "Calculando");

    const measured = await page.evaluate(() => {
        const rect = (selector) => {
            const node = document.querySelector(selector);
            if (!node) return null;
            const box = node.getBoundingClientRect();
            return { width: box.width, height: box.height, top: box.top + window.scrollY };
        };
        const style = (selector, property) => {
            const node = document.querySelector(selector);
            return node ? getComputedStyle(node)[property] : null;
        };
        return {
            state: document.getElementById("mercury-status").dataset.state,
            stateText: document.getElementById("mercury-state").textContent.trim(),
            whenText: document.getElementById("mercury-when").textContent.trim(),
            degreesText: document.getElementById("mercury-degrees").textContent.trim(),
            meterHidden: document.getElementById("mercury-meter").hidden,
            meterWidth: rect("#mercury-meter-fill")?.width ?? 0,
            rows: document.querySelectorAll(".mercury-row:not(.mercury-row-heading)").length,
            yearBars: document.querySelectorAll(".mercury-year-bar.is-retro").length,
            todayLine: document.querySelectorAll(".mercury-year-today").length,
            moreHeight: rect("#mercury-more")?.height ?? 0,
            accent: style(".mercury-status", "borderLeftColor"),
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
            bodyText: document.querySelector(".container").innerText,
            title: document.title,
        };
    });

    await page.screenshot({ path: `/tmp/mercury-${width}.png`, fullPage: true });

    assert.equal(measured.scrollWidth <= measured.innerWidth + 1, true,
        `${label}: horizontal overflow ${measured.scrollWidth} > ${measured.innerWidth}`);
    assert.equal(measured.rows >= 5, true, `${label}: only ${measured.rows} rows rendered`);
    assert.equal(measured.yearBars >= 3, true, `${label}: the map has ${measured.yearBars} bars`);
    assert.equal(measured.todayLine, 1, `${label}: today line missing from the map`);
    assert.equal(measured.moreHeight >= 44, true, `${label}: the toggle is ${measured.moreHeight}px tall`);
    assert.equal(measured.state, expectedState(Date.now()), `${label}: state disagrees with the table`);
    assert.equal(measured.stateText.length > 0, true, `${label}: empty state line`);
    assert.equal(measured.whenText.length > 10, true, `${label}: no countdown line`);
    assert.equal(measured.degreesText.length > 0, true, `${label}: no degree line`);
    assert.equal(/undefined|NaN|null/.test(measured.bodyText), false,
        `${label}: the page leaks a missing value: ${measured.bodyText.match(/[^.]*(undefined|NaN|null)[^.]*/)?.[0]}`);

    if (measured.state === "retro") {
        assert.equal(measured.meterHidden, false, `${label}: the meter is hidden while retrograde`);
        assert.equal(measured.meterWidth > 0, true, `${label}: the meter has no filled width`);
        assert.match(measured.stateText, /retrógrado/i);
    } else {
        assert.equal(measured.meterHidden, true, `${label}: the meter shows outside a retrograde`);
    }

    // The past rows toggle adds rows and turns back into the future view.
    const before = measured.rows;
    await page.click("#mercury-more");
    const after = await page.locator(".mercury-row:not(.mercury-row-heading)").count();
    assert.equal(after > before, true, `${label}: the toggle did not add past rows`);
    const buttonText = (await page.locator("#mercury-more").textContent()).trim();
    assert.match(buttonText, /vienen/i, `${label}: the toggle did not flip its label`);
    await page.screenshot({ path: `/tmp/mercury-${width}-past.png`, fullPage: true });

    // The date picker: the answer has to agree with the table, the sky has to
    // redraw, and a date outside the table has to say so.
    const skyBefore = await page.locator("#mercury-sky svg").innerHTML();
    await page.fill("#mercury-date", "2027-07-01");
    await page.press("#mercury-date", "Enter");
    await page.waitForTimeout(150);
    const retroAnswer = (await page.locator("#mercury-date-answer").textContent()).trim();
    assert.match(retroAnswer, /Retrógrado/, `${label}: 2027-07-01 should be retrograde, said: ${retroAnswer}`);
    const skyAfter = await page.locator("#mercury-sky svg").innerHTML();
    assert.notEqual(skyAfter, skyBefore, `${label}: the sky did not redraw for a new date`);
    const caption = (await page.locator("#mercury-sky-caption").textContent()).trim();
    assert.match(caption, /2027/, `${label}: the caption lost the date`);

    await page.fill("#mercury-date", "2027-07-20");
    await page.press("#mercury-date", "Enter");
    await page.waitForTimeout(150);
    const directAnswer = (await page.locator("#mercury-date-answer").textContent()).trim();
    assert.match(directAnswer, /Directo/, `${label}: 2027-07-20 should be direct, said: ${directAnswer}`);

    await page.fill("#mercury-date", "2055-01-15");
    await page.press("#mercury-date", "Enter");
    await page.waitForTimeout(250);
    const farAnswer = (await page.locator("#mercury-date-answer").textContent()).trim();
    assert.match(farAnswer, /Fuera de la tabla/, `${label}: 2055 was not flagged: ${farAnswer}`);
    assert.match(farAnswer, /Retrógrado|Directo/, `${label}: 2055 has no state: ${farAnswer}`);

    await page.click("#mercury-date-today");
    await page.waitForTimeout(150);
    const todayValue = await page.inputValue("#mercury-date");
    // Local date, not UTC: the picker in the page uses the reader's day.
    const now = new Date();
    const expectedToday = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
    ].join("-");
    assert.equal(todayValue, expectedToday, `${label}: the today button set ${todayValue}`);

    const skyNodes = await page.locator("#mercury-sky svg *").count();
    assert.equal(skyNodes > 25, true, `${label}: the sky has ${skyNodes} nodes`);
    await page.screenshot({ path: `/tmp/mercury-${width}-sky.png`, fullPage: false });

    // The scrubber walks a month either side without moving the anchor, and the
    // chart under it follows the curve of the geocentric longitude.
    const anchorValue = await page.inputValue("#mercury-date");
    const chartBefore = await page.locator("#mercury-chart svg").innerHTML();
    const answerBefore = (await page.locator("#mercury-date-answer").textContent()).trim();
    await page.evaluate(() => {
        const node = document.getElementById("mercury-scrub");
        node.value = "-30";
        node.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForTimeout(200);
    const scrubValue = (await page.locator("#mercury-scrub-value").textContent()).trim();
    assert.match(scrubValue, /-30 días/, `${label}: the scrub label says ${scrubValue}`);
    assert.match(scrubValue, /de \d{4}/, `${label}: the scrub label lost the year`);
    const answerAfter = (await page.locator("#mercury-date-answer").textContent()).trim();
    assert.notEqual(answerAfter, answerBefore, `${label}: the scrubber did not change the answer`);
    assert.equal(await page.inputValue("#mercury-date"), anchorValue,
        `${label}: scrubbing moved the anchor date`);
    assert.notEqual(await page.locator("#mercury-chart svg").innerHTML(), chartBefore,
        `${label}: the chart did not follow the scrubber`);
    assert.equal(await page.locator(".chart-band").count() >= 1, true,
        `${label}: the month around today has a retrograde and the chart shows no band`);

    const chartNodes = await page.locator("#mercury-chart svg *").count();
    assert.equal(chartNodes > 12, true, `${label}: the chart has ${chartNodes} nodes`);
    const curvePath = await page.locator("#mercury-chart .chart-curve").getAttribute("d");
    assert.equal((curvePath.match(/L/g) ?? []).length >= 55, true,
        `${label}: the curve has ${(curvePath.match(/L/g) ?? []).length} segments`);
    await page.locator(".mercury-chart").screenshot({ path: `/tmp/mercury-${width}-chart.png` });

    // A new anchor sends the scrubber back to the middle.
    await page.fill("#mercury-date", "2030-03-03");
    await page.press("#mercury-date", "Enter");
    await page.waitForTimeout(150);
    assert.equal(await page.inputValue("#mercury-scrub"), "0",
        `${label}: the scrubber did not recentre on a new date`);

    // The ring marker has to sit at the degree the text quotes, and it has to
    // walk backwards while Mercury is retrograde. This is the check that the
    // picture and the number are the same number.
    const signs = ["Aries", "Tauro", "Géminis", "Cáncer", "Leo", "Virgo",
        "Libra", "Escorpio", "Sagitario", "Capricornio", "Acuario", "Piscis"];
    const markerAngle = async () => {
        const [x, y] = await page.locator(".sky-seen").evaluate((node) => [
            Number(node.getAttribute("cx")), Number(node.getAttribute("cy")),
        ]);
        return (((Math.atan2(180 - y, x - 180) * 180) / Math.PI) + 360) % 360;
    };
    const quotedLongitude = async () => {
        const text = (await page.locator("#mercury-date-answer").textContent()).trim();
        const found = text.match(/Mercurio está en (\d+)°(\d+)′ de (\w+)/);
        if (!found) return null;
        return signs.indexOf(found[3]) * 30 + Number(found[1]) + Number(found[2]) / 60;
    };
    const scrubTo = async (value) => {
        await page.evaluate((offset) => {
            const node = document.getElementById("mercury-scrub");
            node.value = String(offset);
            node.dispatchEvent(new Event("input", { bubbles: true }));
        }, value);
        await page.waitForTimeout(120);
    };

    // Anchor on the middle of the next window, so this check does not depend on
    // the day the suite happens to run.
    const nextWindow = windows.find((window) => window.start > Date.now());
    assert.notEqual(nextWindow, undefined, `${label}: the table has no future window`);
    const middleOfWindow = new Date((nextWindow.start + nextWindow.end) / 2);
    const middleValue = [
        middleOfWindow.getFullYear(),
        String(middleOfWindow.getMonth() + 1).padStart(2, "0"),
        String(middleOfWindow.getDate()).padStart(2, "0"),
    ].join("-");
    await page.fill("#mercury-date", middleValue);
    await page.press("#mercury-date", "Enter");
    await page.waitForTimeout(150);

    const angles = [];
    for (const offset of [-20, 0, 20]) {
        await scrubTo(offset);
        const quoted = await quotedLongitude();
        assert.notEqual(quoted, null, `${label}: no degree in the answer at ${offset}`);
        const drawn = await markerAngle();
        assert.ok(Math.abs(drawn - quoted) < 0.6,
            `${label}: ring marker at ${drawn.toFixed(1)} while the text says ${quoted.toFixed(1)}`);
        angles.push(drawn);
    }
    // Today falls inside a retrograde, so the middle reading has to be lower
    // than the one twenty days earlier.
    assert.ok(angles[1] < angles[0], `${label}: the marker did not walk backwards: ${angles}`);

    // Playback: it starts, moves the day and stops on its own at the end.
    await scrubTo(-30);
    await page.click("#mercury-play");
    assert.equal(await page.locator("#mercury-play").getAttribute("aria-pressed"), "true",
        `${label}: play did not latch`);
    const playedFrom = (await page.locator("#mercury-scrub-value").textContent()).trim();
    await page.waitForTimeout(900);
    const playedTo = (await page.locator("#mercury-scrub-value").textContent()).trim();
    assert.notEqual(playedTo, playedFrom, `${label}: play did not advance the day`);
    await page.click("#mercury-play");
    assert.equal(await page.locator("#mercury-play").getAttribute("aria-pressed"), "false",
        `${label}: pause did not release`);

    await page.close();
    return measured;
}

const narrow = await inspect(390, 844, "390px");
const wide = await inspect(1440, 900, "1440px");

// The home page still links to the page it should.
const homePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
await homePage.goto(`${BASE}/index.html`, { waitUntil: "networkidle" });
assert.equal(await homePage.locator('a[href="./mercury/"]').count(), 1, "home lost the mercury link");
await homePage.close();

await browser.close();

if (problems.length) failures.push(...problems);
if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
}

console.log("mercury page ok");
console.log(`  today     : ${narrow.state} · ${narrow.stateText}`);
console.log(`  next      : ${narrow.whenText}`);
console.log(`  degrees   : ${narrow.degreesText}`);
console.log(`  rows      : ${narrow.rows} at 390px, ${wide.rows} at 1440px`);
console.log(`  bars      : ${narrow.yearBars} retrograde bars in the map`);
console.log(`  accent    : ${narrow.accent}`);
