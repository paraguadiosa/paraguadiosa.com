// ephemeris.js
// A small VSOP87 in the browser, trimmed at build time by
// scripts/build_ephemeris.py. It gives the two things the page needs to move
// with the clock: where Earth and Mercury are around the Sun, and where Mercury
// looks like it is from Earth (the geocentric longitude that decides whether it
// is retrograde).
//
// The exact station instants still come from mercury/data/retrograde.json. This
// module draws the sky and answers for dates the table does not cover.
//
// Accuracy of the trimmed series: 8.4 arcsec in geocentric longitude over
// 1925-2075, measured at build time against the full theory.

const J2000 = 2451545.0;
const LIGHT_TIME_PER_AU = 0.0057755183; // days
const DEG = 180 / Math.PI;

export async function loadEphemeris(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return createEphemeris(await response.json());
}

export function createEphemeris(table) {
    const { mercury, earth } = table.bodies;

    // VSOP87 wants the time in Julian millennia from J2000, and the series run
    // in radians scaled by 1e8.
    function series(body, name, millennia) {
        const groups = body[name];
        let total = 0;
        let power = 1;
        for (let index = 0; index < groups.length; index += 1) {
            let sum = 0;
            const terms = groups[index];
            for (let term = 0; term < terms.length; term += 1) {
                const [amplitude, phase, frequency] = terms[term];
                sum += amplitude * Math.cos(phase + frequency * millennia);
            }
            total += sum * power;
            power *= millennia;
        }
        return total / 1e8;
    }

    function vector(body, millennia) {
        const longitude = series(body, "L", millennia);
        const latitude = series(body, "B", millennia);
        const distance = series(body, "R", millennia);
        const flat = distance * Math.cos(latitude);
        return {
            x: flat * Math.cos(longitude),
            y: flat * Math.sin(longitude),
            z: distance * Math.sin(latitude),
            longitude: ((longitude * DEG) % 360 + 360) % 360,
            latitude: latitude * DEG,
            distance,
        };
    }

    // UT to TT: the difference is under a minute of arc of motion for Mercury,
    // but the table is in TT and the two have to agree when they are compared.
    function deltaT(year) {
        const t = year - 2000;
        return 62.92 + 0.32217 * t + 0.005589 * t * t;
    }

    function julianEphemeris(date) {
        const julianDay = date.getTime() / 86400000 + 2440587.5;
        const year = date.getUTCFullYear() + (date.getUTCMonth() + 0.5) / 12;
        return julianDay + deltaT(year) / 86400;
    }

    function earthAt(date) {
        return vector(earth, (julianEphemeris(date) - J2000) / 365250);
    }

    function mercuryAt(date) {
        return vector(mercury, (julianEphemeris(date) - J2000) / 365250);
    }

    function geocentric(date) {
        const here = earthAt(date);
        let there = mercuryAt(date);
        // Light time: Mercury is seen where it was when the light left it.
        for (let pass = 0; pass < 2; pass += 1) {
            const gap = Math.hypot(there.x - here.x, there.y - here.y, there.z - here.z);
            there = mercuryAt(new Date(date.getTime() - gap * LIGHT_TIME_PER_AU * 86400000));
        }
        const x = there.x - here.x;
        const y = there.y - here.y;
        const z = there.z - here.z;
        const longitude = ((Math.atan2(y, x) * DEG) % 360 + 360) % 360;
        return {
            longitude,
            latitude: Math.atan2(z, Math.hypot(x, y)) * DEG,
            distance: Math.hypot(x, y, z),
        };
    }

    // Degrees of geocentric longitude per day, centred on the instant. The sign
    // is all that matters: negative means retrograde.
    function motion(date) {
        const half = 6 * 3600000;
        const before = geocentric(new Date(date.getTime() - half)).longitude;
        const after = geocentric(new Date(date.getTime() + half)).longitude;
        let delta = after - before;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        return delta;
    }

    // Nearest rate sign change around a date, walked in half-day steps. Used
    // only outside the table, so the coarse walk is enough: it is bisected
    // afterwards to the minute. `previous` is the last change before the date,
    // `next` the first one after; when the date is retrograde the two are the
    // stations that open and close it.
    function nearestStations(date) {
        // A day per step: between two stations Mercury spends two to three
        // months direct, so a finer walk buys nothing and a coarser one can
        // jump over a short window.
        const step = 86400000;
        const limit = 200;
        const rateAt = (millis) => motion(new Date(millis));

        function bracket(direction) {
            let previous = rateAt(date.getTime());
            for (let index = 1; index <= limit; index += 1) {
                const millis = date.getTime() + direction * index * step;
                const current = rateAt(millis);
                if (previous * current < 0) {
                    const edge = millis - direction * step;
                    let low = Math.min(edge, millis);
                    let high = Math.max(edge, millis);
                    const lowNegative = rateAt(low) < 0;
                    for (let pass = 0; pass < 30; pass += 1) {
                        const middle = (low + high) / 2;
                        if ((rateAt(middle) < 0) === lowNegative) low = middle;
                        else high = middle;
                    }
                    return new Date((low + high) / 2);
                }
                previous = current;
            }
            return null;
        }

        return {
            retrograde: rateAt(date.getTime()) < 0,
            previous: bracket(-1),
            next: bracket(1),
        };
    }

    return { earthAt, mercuryAt, geocentric, motion, nearestStations, julianEphemeris, deltaT };
}
