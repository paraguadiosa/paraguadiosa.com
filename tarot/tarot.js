// tarot.js
// TempleOS RNG port, the draw and the reading composition.
// Pure module: no network, no DOM, no inference. The reading is built
// word for word from the author's card notes.

const MASK64 = (1n << 64n) - 1n;
const A = 6364136223846793005n;
const C = 1442695040888963407n;
const MAX_SEED = 2 ** 53 - 1;

export const SPREADS = {
    one: ["La carta"],
    three: ["Situación", "Nudo", "Salida"],
};

export const SPREAD_LABELS = {
    one: "Una carta",
    three: "Tres cartas",
};

export function makeTempleRng(seed) {
    let state = BigInt(seed) & MASK64;
    return {
        next() {
            let res = state;
            const mid = (res >> 16n) & 0xFFFFFFFFn;
            res = (A * res) & MASK64;
            res ^= mid;
            res = (res + C) & MASK64;
            state = res;
            return Number(res & 0xFFFFFFFFn);
        },
    };
}

export function newSeed() {
    // 53 bits so the seed stays a safe integer in JavaScript.
    const words = new Uint32Array(2);
    crypto.getRandomValues(words);
    const high = words[0] & 0x1FFFFF;
    return high * 0x100000000 + words[1];
}

export function draw(seed, count) {
    // Fisher-Yates over 0..77, descending, then one bit per card.
    const rng = makeTempleRng(seed);
    const deck = Array.from({ length: 78 }, (_, i) => i);
    for (let i = 77; i >= 1; i--) {
        const value = rng.next();
        const j = value % (i + 1);
        const swap = deck[i];
        deck[i] = deck[j];
        deck[j] = swap;
    }
    const cards = [];
    for (let k = 0; k < count; k++) {
        const value = rng.next();
        cards.push({ index: deck[k], bit: value & 1 });
    }
    return cards;
}

export function composeReading(cards, drawn) {
    // cards is the ordered cards.json array. drawn is the draw() result.
    return drawn.map(({ index, bit }) => {
        const card = cards[index];
        const reversed = bit === 1;
        return {
            id: card.id,
            name: card.name,
            image: card.image,
            keywords: card.keywords,
            orientation: reversed ? "invertida" : "al derecho",
            text: reversed ? card.reversed : card.upright,
        };
    });
}

export function validSeed(value) {
    const seed = Number(value);
    return Number.isSafeInteger(seed) && seed >= 0 && seed <= MAX_SEED;
}
