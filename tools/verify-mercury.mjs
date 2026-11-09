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
