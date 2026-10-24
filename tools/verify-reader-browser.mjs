// tools/verify-reader-browser.mjs
// Browser checks for the tarot EPUB reader. Needs playwright (not a repo
// dependency: run it from a machine that has it, e.g. `npm i -g playwright`).
//
//   node tools/verify-reader-browser.mjs [base-url]
//
// Default base url is a local static server: python3 -m http.server 8765

import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE = (process.argv[2] ?? "http://127.0.0.1:8765").replace(/\/$/, "");

const frameText = async (page) => {
    let best = "";
    for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        try {
            const text = await frame.evaluate(() => (document.body ? document.body.innerText : ""));
            if (text.length > best.length) best = text;
        } catch (error) {
            // Cross-origin frames are not readable; ignore them.
        }
    }
    return best.trim();
};

const browser = await chromium.launch();
const failures = [];
const requests404 = [];

const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("response", (response) => {
    if (response.status() >= 400) requests404.push(`${response.status()} ${response.url()}`);
});

// 1. The spread page links to the reader.
await page.goto(`${BASE}/tarot/index.html`, { waitUntil: "networkidle" });
const link = page.locator('a[href="./leer/index.html"]');
assert.equal(await link.count(), 1, "the spread page has no link to the reader");
console.log("ok 1 - spread page exposes the reader link");

await link.click();
await page.waitForURL("**/leer/index.html", { timeout: 15000 });
console.log("ok 2 - the link navigates to /tarot/leer/");

// 2. The book renders text (the first section is a cover, so step once).
await page.waitForTimeout(6000);
const cover = await frameText(page);
assert.ok(await page.locator("foliate-view").count() === 1, "no foliate-view in the page");
console.log("ok 3 - foliate-view mounted");

await page.keyboard.press("ArrowRight");
await page.waitForTimeout(2500);
let text = await frameText(page);
if (text.length < 200) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(2500);
    text = await frameText(page);
}
assert.ok(text.length > 200, `expected rendered text, got ${text.length} chars`);
console.log(`ok 4 - text renders (${text.length} chars: "${text.slice(0, 60).replace(/\n/g, " ")}...")`);

// 3. The next button advances, the progress bar moves.
//    Note: the paginated renderer lays the whole section inside one iframe, so
//    the frame text does not change between pages of the same section. Progress
//    and the stored CFI are the honest signals.
const pctBefore = await page.locator("#reader-pct").innerText();
const cfiBefore = await page.evaluate(() => localStorage.getItem("tarot-reader-cfi"));
for (let i = 0; i < 3; i++) {
    await page.locator("#reader-next").click();
    await page.waitForTimeout(900);
}
const pctAfter = await page.locator("#reader-pct").innerText();
const cfiAfter = await page.evaluate(() => localStorage.getItem("tarot-reader-cfi"));
assert.notEqual(pctAfter, pctBefore, "next did not advance the progress");
assert.notEqual(cfiAfter, cfiBefore, "next did not change the stored CFI");
console.log(`ok 5 - next advances (${pctBefore} -> ${pctAfter})`);

// 4. Going back returns to a previous position.
await page.locator("#reader-prev").click();
await page.waitForTimeout(1200);
const pctBack = await page.locator("#reader-pct").innerText();
const cfiBack = await page.evaluate(() => localStorage.getItem("tarot-reader-cfi"));
assert.notEqual(cfiBack, cfiAfter, "prev did not move");
console.log(`ok 6 - prev moves back (${pctAfter} -> ${pctBack})`);

// 5. The position survives a reload.
const cfi = await page.evaluate(() => localStorage.getItem("tarot-reader-cfi"));
assert.ok(cfi && cfi.startsWith("epubcfi("), `no CFI stored, got ${cfi}`);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(5000);
const pctReload = await page.locator("#reader-pct").innerText();
assert.notEqual(pctReload, "0%", "the reading position was not restored");
console.log(`ok 7 - position restored after reload (${pctReload})`);

// 6. No 404s anywhere: the vendored modules all resolve.
assert.equal(requests404.length, 0, `failed requests: ${requests404.join(", ")}`);
console.log("ok 8 - every asset loaded (no 4xx)");

await page.screenshot({ path: "/tmp/tarot-reader-desktop.png" });

// 7. Mobile 390px: no horizontal overflow, controls reachable.
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await mobile.goto(`${BASE}/tarot/leer/index.html`, { waitUntil: "networkidle" });
await mobile.waitForTimeout(6000);
await mobile.keyboard.press("ArrowRight");
await mobile.waitForTimeout(2000);
const overflow = await mobile.evaluate(() => {
    const doc = document.documentElement;
    return { scrollW: doc.scrollWidth, clientW: doc.clientWidth };
});
assert.equal(overflow.scrollW, overflow.clientW, `mobile overflows: ${JSON.stringify(overflow)}`);
const nextBox = await mobile.locator("#reader-next").boundingBox();
assert.ok(nextBox && nextBox.y > 600, `next button not at the bottom: ${JSON.stringify(nextBox)}`);
const mobileText = await frameText(mobile);
assert.ok(mobileText.length > 100, `mobile renders ${mobileText.length} chars`);
console.log(`ok 9 - mobile 390px: no overflow, controls at y=${Math.round(nextBox.y)}, ${mobileText.length} chars`);
await mobile.screenshot({ path: "/tmp/tarot-reader-mobile.png" });

await browser.close();
console.log(`\n9 checks passed (cover section: ${cover.length} chars)`);
