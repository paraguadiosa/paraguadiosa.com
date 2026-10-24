// tarot-rng.test.mjs
// Node-only checks for the static tarot page. No dependencies.
// Run with: npm test  (or: node --test 'tests/**/*.test.mjs')

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
    SPREADS,
    composeReading,
    draw,
    makeTempleRng,
    newSeed,
} from "../tarot/tarot.js";

const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) =>
    readFileSync(path.join(SITE_ROOT, relative), "utf8");

test("gate vector: first Fisher-Yates swap is i 77, j 53", () => {
    const rng = makeTempleRng(4259774627441039n);
    const value = rng.next();
    assert.equal(value, 3278663597);
    assert.equal(value % 78, 53);
});

test("gate vector: seed 4259774627441039 draws 68, 37, 55 with bits 0, 1, 0", () => {
    const cards = draw(4259774627441039n, 3);
    assert.deepEqual(cards.map((card) => card.index), [68, 37, 55]);
    assert.deepEqual(cards.map((card) => card.bit), [0, 1, 0]);
});

test("vector 123456789012345: first swap j 5, cards 53, 9, 43 all upright", () => {
    const rng = makeTempleRng(123456789012345n);
    const value = rng.next();
    assert.equal(value, 391793303);
    assert.equal(value % 78, 5);
    const cards = draw(123456789012345n, 3);
    assert.deepEqual(cards.map((card) => card.index), [53, 9, 43]);
    assert.deepEqual(cards.map((card) => card.bit), [0, 0, 0]);
});

test("vector 777777777777777: first swap j 30, cards 11, 28, 47 with one reversed", () => {
    const rng = makeTempleRng(777777777777777n);
    const value = rng.next();
    assert.equal(value, 2102235204);
    assert.equal(value % 78, 30);
    const cards = draw(777777777777777n, 3);
    assert.deepEqual(cards.map((card) => card.index), [11, 28, 47]);
    assert.deepEqual(cards.map((card) => card.bit), [0, 0, 1]);
});

test("a draw never repeats a card and every bit is 0 or 1", () => {
    const seeds = [0n, 1n, 42n, 4259774627441039n, 777777777777777n];
    for (const seed of seeds) {
        const cards = draw(seed, 3);
        const indices = cards.map((card) => card.index);
        assert.equal(new Set(indices).size, indices.length, "cards repeat");
        for (const card of cards) {
            assert.ok(card.bit === 0 || card.bit === 1, "bit out of range");
        }
    }
});

test("newSeed returns a 53-bit safe integer", () => {
    for (let i = 0; i < 8; i++) {
        const seed = newSeed();
        assert.ok(Number.isSafeInteger(seed));
        assert.ok(seed >= 0 && seed <= 2 ** 53 - 1);
    }
});

test("composeReading picks the full upright or reversed note", () => {
    const cards = [
        {
            id: "major-00",
            name: "El Loco",
            image: "cards/major-00.jpg",
            keywords: ["comienzo", "salto"],
            upright: "NOTA AL DERECHO",
            reversed: "NOTA INVERTIDA",
        },
        {
            id: "major-01",
            name: "El Mago",
            image: "cards/major-01.jpg",
            keywords: ["voluntad"],
            upright: "NOTA DOS DERECHO",
            reversed: "NOTA DOS INVERTIDA",
        },
    ];
    const reading = composeReading(cards, [
        { index: 0, bit: 1 },
        { index: 1, bit: 0 },
    ]);
    assert.equal(reading[0].text, "NOTA INVERTIDA");
    assert.equal(reading[0].orientation, "invertida");
    assert.equal(reading[1].text, "NOTA DOS DERECHO");
    assert.equal(reading[1].orientation, "al derecho");
    assert.deepEqual(SPREADS.three, ["Situación", "Nudo", "Salida"]);
});

test("the page and the data files exist", () => {
    assert.ok(existsSync(path.join(SITE_ROOT, "tarot", "index.html")));
    assert.ok(existsSync(path.join(SITE_ROOT, "tarot", "tarot.js")));
    assert.ok(existsSync(path.join(SITE_ROOT, "tarot", "tarot.css")));
    assert.ok(existsSync(path.join(SITE_ROOT, "tarot", "data", "cards.json")));
});

test("cards.json holds 78 cards in app order with their images", () => {
    const cards = JSON.parse(read("tarot/data/cards.json"));
    assert.equal(cards.length, 78);

    const ids = cards.map((card) => card.id);
    for (let i = 0; i < 22; i++) {
        assert.equal(ids[i], `major-${String(i).padStart(2, "0")}`);
    }
    const suits = ["cups", "pentacles", "wands", "swords"];
    let offset = 22;
    for (const suit of suits) {
        for (let rank = 1; rank <= 14; rank++) {
            assert.equal(ids[offset], `${suit}-${String(rank).padStart(2, "0")}`);
            offset += 1;
        }
    }

    for (const card of cards) {
        for (const field of ["id", "name", "keywords", "upright", "reversed", "image"]) {
            assert.ok(field in card, `missing field ${field}`);
        }
        assert.equal(card.image, `cards/${card.id}.jpg`);
        assert.ok(existsSync(path.join(SITE_ROOT, "tarot", card.image)));
    }
});

test("the temple background ships the real RNG constants, static and local", () => {
    const html = read("tarot/index.html");
    const css = read("tarot/tarot.css");

    // The numbers must match A and C in tarot.js, decimal and hex.
    assert.match(html, /6364136223846793005/);
    assert.match(html, /1442695040888963407/);
    assert.match(html, /0x5851F42D4C957F2D/);
    assert.match(html, /0x14057B7EF767814F/);

    // Decoration only, and no runtime: no canvas, no animation, no external URL.
    assert.match(html, /class="tarot-code-bg" aria-hidden="true"/);
    assert.doesNotMatch(html, /<canvas/);
    assert.doesNotMatch(css, /@keyframes|animation:/);

    // The background block is self-contained: nothing it loads over the network.
    const bg = html.match(/<div class="tarot-code-bg"[\s\S]*?<\/div>/);
    assert.ok(bg, "missing tarot-code-bg block");
    assert.doesNotMatch(bg[0], /https?:\/\/|<img|<script|<canvas/);

    // The wallpaper is gone for the tarot page: the code is the texture.
    assert.match(css, /body\.tarot \{[\s\S]*?background-image: none/);
});

test("tarot.js makes no network call", () => {
    const source = read("tarot/tarot.js");
    assert.doesNotMatch(source, /\bfetch\s*\(/);
    assert.doesNotMatch(source, /XMLHttpRequest/);
    assert.doesNotMatch(source, /https?:\/\//);
});

test("the front page links to the tarot", () => {
    assert.match(read("index.html"), /<a href="\.\/tarot\/">/);
});

// Read width and height straight out of the JPEG SOF marker. No image library.
function jpegSize(buffer) {
    let offset = 2;
    while (offset < buffer.length - 9) {
        if (buffer[offset] !== 0xff) {
            offset += 1;
            continue;
        }
        const marker = buffer[offset + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
            return {
                height: buffer.readUInt16BE(offset + 5),
                width: buffer.readUInt16BE(offset + 7),
            };
        }
        offset += 2 + buffer.readUInt16BE(offset + 2);
    }
    return { width: 0, height: 0 };
}

test("every card image is 480 x 848 so a spread renders level", () => {
    const directory = path.join(SITE_ROOT, "tarot", "cards");
    const files = readdirSync(directory).filter((name) => name.endsWith(".jpg"));
    assert.equal(files.length, 78);
    const wrong = files
        .map((name) => {
            const { width, height } = jpegSize(readFileSync(path.join(directory, name)));
            return { name, width, height };
        })
        .filter((image) => image.width !== 480 || image.height !== 848);
    assert.deepEqual(wrong, []);
});
