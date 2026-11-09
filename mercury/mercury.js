// mercury.js
// Reads mercury/data/retrograde.json (the exact station table, built by
// scripts/build_mercury.py) and mercury/data/vsop87.json (a trimmed ephemeris,
// built by scripts/build_ephemeris.py).
//
// Two things live here: the answer for today, and the answer for any date the
// reader picks, with a sky that shows where Earth and Mercury are. No model, no
// backend, no API.

import { loadEphemeris } from "./ephemeris.js";

const SIGNS_ES = [
    "Aries", "Tauro", "Géminis", "Cáncer", "Leo", "Virgo",
    "Libra", "Escorpio", "Sagitario", "Capricornio", "Acuario", "Piscis",
];

const SIGNS_SHORT = [
    "Ari", "Tau", "Gém", "Cán", "Leo", "Vir",
    "Lib", "Esc", "Sag", "Cap", "Acu", "Pis",
];

// The table stores the sign names in English (they are the field values of the
// generator), so the index has to be resolved before the Spanish label is read.
const SIGN_INDEX = new Map([
    ["Aries", 0], ["Taurus", 1], ["Gemini", 2], ["Cancer", 3],
    ["Leo", 4], ["Virgo", 5], ["Libra", 6], ["Scorpio", 7],
    ["Sagittarius", 8], ["Capricorn", 9], ["Aquarius", 10], ["Pisces", 11],
]);

const UPCOMING_ROWS = 6;
const PAST_ROWS = 6;
const YEAR_ROWS = 3;
const DAY_MS = 86400000;
const RAD = Math.PI / 180;

const dayFormat = new Intl.DateTimeFormat("es-PY", { day: "numeric", month: "long" });
const dayYearFormat = new Intl.DateTimeFormat("es-PY", { day: "numeric", month: "long", year: "numeric" });

const statusNode = document.getElementById("mercury-status");
const stateNode = document.getElementById("mercury-state");
const whenNode = document.getElementById("mercury-when");
const degreesNode = document.getElementById("mercury-degrees");
const meterNode = document.getElementById("mercury-meter");
const meterFillNode = document.getElementById("mercury-meter-fill");
const listNode = document.getElementById("mercury-list");
const moreNode = document.getElementById("mercury-more");
const yearsNode = document.getElementById("mercury-years");
const generatedNode = document.getElementById("mercury-generated");
const rangeNode = document.getElementById("mercury-range");
const dateForm = document.getElementById("mercury-date-form");
const dateInput = document.getElementById("mercury-date");
const dateTodayButton = document.getElementById("mercury-date-today");
const dateAnswerNode = document.getElementById("mercury-date-answer");
const scrubNode = document.getElementById("mercury-scrub");
const scrubValueNode = document.getElementById("mercury-scrub-value");
const scrubStartNode = document.getElementById("mercury-scrub-start");
const scrubEndNode = document.getElementById("mercury-scrub-end");
const skyNode = document.getElementById("mercury-sky");
const skyCaptionNode = document.getElementById("mercury-sky-caption");
const playNode = document.getElementById("mercury-play");
const chartNode = document.getElementById("mercury-chart");
const chartCaptionNode = document.getElementById("mercury-chart-caption");

// ---------- text helpers ----------

const dayText = (date) => dayFormat.format(date);
const dayYearText = (date) => dayYearFormat.format(date);

// "en 5 días", "en 3 días y 4 horas", "en 9 horas", "ya".
function countdownText(target, now) {
    const left = target.getTime() - now.getTime();
    if (left <= 0) return "ya";
    const hours = Math.round(left / 3600000);
    if (hours <= 1) return "en menos de una hora";
    if (hours < 36) return `en ${hours} horas`;
    const days = Math.floor(left / DAY_MS);
    const restHours = Math.round((left - days * DAY_MS) / 3600000);
    if (days < 2) return `en 1 día y ${restHours} horas`;
    if (restHours >= 20) return `en ${days + 1} días`;
    return `en ${days} días`;
}

// 20.98 -> "20°59′"
function degreeText(degrees) {
    const whole = Math.floor(degrees);
    const minutes = Math.round((degrees - whole) * 60);
    const safeWhole = minutes === 60 ? whole + 1 : whole;
    const safeMinutes = minutes === 60 ? 0 : minutes;
    return `${safeWhole}°${String(safeMinutes).padStart(2, "0")}′`;
}

function place(longitude) {
    const index = Math.floor((((longitude % 360) + 360) % 360) / 30);
    const degree = (((longitude % 360) + 360) % 360) % 30;
    return `${degreeText(degree)} de ${SIGNS_ES[index]}`;
}

function stationPair(window) {
    return `${degreeText(window.retrograde.degree)} de ${SIGNS_ES[window.retrograde.index]}`
        + ` a ${degreeText(window.direct.degree)} de ${SIGNS_ES[window.direct.index]}`;
}

function dayOfWindow(window, when) {
    const total = Math.max(1, Math.ceil(window.days));
    const elapsed = Math.max(0, Math.floor((when - window.start) / DAY_MS));
    return { day: Math.min(elapsed + 1, total), total };
}

// ---------- data ----------

function prepare(payload) {
    return payload.windows.map((window) => ({
        start: new Date(window.start),
        end: new Date(window.end),
        shadowStart: new Date(window.shadow_start),
        shadowEnd: new Date(window.shadow_end),
        days: window.days,
        retrograde: { ...window.retrograde, index: SIGN_INDEX.get(window.retrograde.sign) },
        direct: { ...window.direct, index: SIGN_INDEX.get(window.direct.sign) },
    }));
}

function stateOf(windows, now) {
    const current = windows.find((window) => window.start <= now && now <= window.end);
    if (current) return { kind: "retro", current };
    const next = windows.find((window) => window.start > now);
    if (next && now >= next.shadowStart) return { kind: "shadow", next };
    if (next) return { kind: "direct", next };
    return { kind: "unknown" };
}

// Everything the page needs to say about one instant, from the table when the
// date is inside it and from the ephemeris when it is not.
function resolve(when, windows, ephemeris) {
    const current = windows.find((window) => window.start <= when && when <= window.end);
    const next = windows.find((window) => window.start > when);
    const previous = [...windows].reverse().find((window) => window.end < when);
    const first = windows[0];
    const last = windows[windows.length - 1];

    const answer = {
        // The table covers whole windows, shadows included: outside that span
        // the browser has to place the stations itself.
        exact: when >= first.shadowStart && when <= last.shadowEnd,
        retro: Boolean(current),
        window: current ?? null,
        nextWindow: next ?? null,
        previousWindow: previous ?? null,
        shadow: null,
        start: current?.start ?? null,
        end: current?.end ?? null,
    };

    if (current) {
        answer.shadow = "inside";
    } else if (next && when >= next.shadowStart) {
        answer.shadow = "before";
    } else if (previous && when <= previous.shadowEnd) {
        answer.shadow = "after";
    }

    if (ephemeris) {
        answer.longitude = ephemeris.geocentric(new Date(when)).longitude;
        if (!answer.exact) {
            // Outside the table: the browser places the stations itself. A sign
            // change backwards closes the previous window, one forwards opens
            // the next, and which is which depends on the date.
            const stations = ephemeris.nearestStations(new Date(when));
            answer.approximate = true;
            if (stations.retrograde) {
                answer.retro = true;
                answer.start = stations.previous;
                answer.end = stations.next;
            } else {
                answer.retro = false;
                answer.nextStart = stations.next;
                answer.previousEnd = stations.previous;
            }
        }
    }

    return answer;
}

// ---------- today ----------

function renderStatus(windows, now) {
    const state = stateOf(windows, now);

    if (state.kind === "retro") {
        const { current } = state;
        statusNode.dataset.state = "retro";
        stateNode.textContent = "Mercurio está retrógrado";
        const { day, total } = dayOfWindow(current, now);
        whenNode.textContent = `Día ${day} de ${total}. Vuelve a directo el `
            + `${dayText(current.end)}, ${countdownText(current.end, now)}.`;
        meterNode.hidden = false;
        const progress = Math.min(1, Math.max(0, (now - current.start) / (current.end - current.start)));
        meterFillNode.style.width = `${(progress * 100).toFixed(1)}%`;
        degreesNode.textContent = `Retrograda ${stationPair(current)}.`;
        degreesNode.hidden = false;
        return;
    }

    meterNode.hidden = true;
    degreesNode.hidden = false;

    if (state.kind === "shadow") {
        const { next } = state;
        statusNode.dataset.state = "shadow";
        stateNode.textContent = "Mercurio está directo, ya en la sombra";
        whenNode.textContent = `La zona de la próxima arranca acá: el retrógrado empieza el `
            + `${dayYearText(next.start)}, ${countdownText(next.start, now)}.`;
        degreesNode.textContent = `Va a retrogradar ${stationPair(next)}.`;
        return;
    }

    if (state.kind === "direct") {
        const { next } = state;
        statusNode.dataset.state = "direct";
        stateNode.textContent = "Mercurio está directo";
        whenNode.textContent = `El próximo retrógrado arranca el ${dayYearText(next.start)}, `
            + `${countdownText(next.start, now)}.`;
        degreesNode.textContent = `Y va a retrogradar ${stationPair(next)}.`;
        return;
    }

    statusNode.dataset.state = "unknown";
    stateNode.textContent = "Sin datos para esta fecha";
    whenNode.textContent = "La tabla no llega hasta acá. Hay que volver a correr el generador.";
    degreesNode.hidden = true;
}

// ---------- the list ----------

function rowFor(window, now, markNow) {
    const row = document.createElement("li");
    row.className = "mercury-row";

    const when = document.createElement("p");
    when.className = "mercury-row-when";
    // A window that straddles New Year needs both years, or it reads as if it
    // started in December of the closing year.
    when.textContent = window.start.getFullYear() === window.end.getFullYear()
        ? `${dayText(window.start)} → ${dayText(window.end)} de ${window.end.getFullYear()}`
        : `${dayYearText(window.start)} → ${dayYearText(window.end)}`;
    if (markNow) {
        const badge = document.createElement("span");
        badge.className = "mercury-badge";
        badge.textContent = "ahora";
        when.append(" ", badge);
    }

    const sign = document.createElement("p");
    sign.className = "mercury-row-sign";
    sign.textContent = stationPair(window);

    const meta = document.createElement("p");
    meta.className = "mercury-row-meta";
    meta.textContent = `${Math.round(window.days)} días · sombra ${dayText(window.shadowStart)} → ${dayText(window.shadowEnd)}`;

    row.append(when, sign, meta);
    return row;
}

function renderList(windows, now, includePast) {
    listNode.replaceChildren();
    const current = stateOf(windows, now).current;
    const future = windows.filter((window) => window.end >= now).slice(0, UPCOMING_ROWS);
    const past = windows.filter((window) => window.end < now).slice(-PAST_ROWS).reverse();

    if (includePast && past.length) {
        const heading = document.createElement("li");
        heading.className = "mercury-row mercury-row-heading";
        heading.textContent = "Ya pasaron";
        listNode.append(heading);
        past.forEach((window) => listNode.append(rowFor(window, now, false)));
        const divider = document.createElement("li");
        divider.className = "mercury-row mercury-row-heading";
        divider.textContent = "Lo que queda";
        listNode.append(divider);
    }

    if (!future.length) {
        const empty = document.createElement("li");
        empty.className = "mercury-row mercury-row-placeholder";
        empty.textContent = "No queda ninguna en la tabla: hay que regenerarla.";
        listNode.append(empty);
        return;
    }

    future.forEach((window) => {
        listNode.append(rowFor(window, now, current === window));
    });
}

// ---------- the year map ----------

function percentOfYear(instant, yearStart, yearEnd) {
    const span = yearEnd - yearStart;
    const offset = (instant - yearStart) / span;
    return Math.min(1, Math.max(0, offset)) * 100;
}

function renderMap(windows, now) {
    yearsNode.replaceChildren();
    const firstYear = now.getFullYear();

    for (let year = firstYear; year < firstYear + YEAR_ROWS; year += 1) {
        const yearStart = new Date(year, 0, 1);
        const yearEnd = new Date(year + 1, 0, 1);

        const row = document.createElement("div");
        row.className = "mercury-year";

        const label = document.createElement("span");
        label.className = "mercury-year-label";
        label.textContent = String(year);

        const track = document.createElement("div");
        track.className = "mercury-year-track";

        windows.forEach((window) => {
            if (window.shadowEnd < yearStart || window.shadowStart > yearEnd) return;

            const shadowLeft = percentOfYear(window.shadowStart, yearStart, yearEnd);
            const shadowRight = percentOfYear(window.shadowEnd, yearStart, yearEnd);
            const retroLeft = percentOfYear(window.start, yearStart, yearEnd);
            const retroRight = percentOfYear(window.end, yearStart, yearEnd);
            const isNow = window.start <= now && now <= window.end;

            const shadowBar = document.createElement("span");
            shadowBar.className = "mercury-year-bar is-shadow";
            shadowBar.style.left = `${shadowLeft}%`;
            shadowBar.style.width = `${Math.max(0.4, shadowRight - shadowLeft)}%`;
            shadowBar.title = `sombra ${dayText(window.shadowStart)} → ${dayText(window.shadowEnd)}`;

            const retroBar = document.createElement("span");
            retroBar.className = isNow ? "mercury-year-bar is-retro is-now" : "mercury-year-bar is-retro";
            retroBar.style.left = `${retroLeft}%`;
            retroBar.style.width = `${Math.max(0.6, retroRight - retroLeft)}%`;
            retroBar.title = `retrógrado ${dayText(window.start)} → ${dayText(window.end)}`;

            track.append(shadowBar, retroBar);
        });

        if (now >= yearStart && now < yearEnd) {
            const today = document.createElement("span");
            today.className = "mercury-year-today";
            today.style.left = `${percentOfYear(now, yearStart, yearEnd)}%`;
            today.title = "hoy";
            track.append(today);
        }

        row.append(label, track);
        yearsNode.append(row);
    }
}

// ---------- any date: the answer ----------

function renderDateAnswer(when, answer) {
    const parts = [];

    if (answer.retro && answer.start && answer.end) {
        const total = Math.max(1, Math.ceil((answer.end - answer.start) / DAY_MS));
        const elapsed = Math.max(0, Math.floor((when - answer.start) / DAY_MS));
        parts.push(`<span class="is-retro">Retrógrado</span>. Día ${Math.min(elapsed + 1, total)} de ${total}, `
            + `del ${dayYearText(answer.start)} al ${dayYearText(answer.end)}.`);
    } else if (answer.retro) {
        parts.push(`<span class="is-retro">Retrógrado</span>.`);
    } else if (answer.shadow === "before" && answer.nextWindow) {
        parts.push(`<strong>Directo</strong>, en la sombra previa: el próximo arranca el `
            + `${dayYearText(answer.nextWindow.start)}, ${countdownText(answer.nextWindow.start, when)}.`);
    } else if (answer.shadow === "after" && answer.previousWindow) {
        parts.push(`<strong>Directo</strong>, todavía en la sombra del que terminó el `
            + `${dayYearText(answer.previousWindow.end)}.`);
    } else if (answer.nextWindow) {
        parts.push(`<strong>Directo</strong>. El próximo arranca el `
            + `${dayYearText(answer.nextWindow.start)}, ${countdownText(answer.nextWindow.start, when)}.`);
    } else if (answer.nextStart) {
        parts.push(`<strong>Directo</strong>. El próximo arranca el `
            + `${dayYearText(answer.nextStart)}, ${countdownText(answer.nextStart, when)}.`);
    } else if (answer.previousEnd) {
        parts.push(`<strong>Directo</strong>. El anterior terminó el ${dayYearText(answer.previousEnd)}.`);
    } else {
        parts.push("No hay datos para esa fecha.");
    }

    if (answer.longitude !== undefined) {
        parts.push(`Mercurio está en ${place(answer.longitude)}.`);
    }

    if (answer.approximate) {
        parts.push("Fuera de la tabla (2020 a 2040): esta fecha la calcula el navegador, "
            + "con minutos de diferencia en las estaciones.");
    }

    dateAnswerNode.innerHTML = parts.join(" ");
}

// ---------- the sky ----------

const SKY = {
    size: 360,
    center: 180,
    ring: 140,
    labels: 124,
    ticks: 148,
    earthOrbit: 92,
    mercuryOrbit: 92 * 0.387,
};

// Text next to a dot reads inward or outward depending on which side of the
// circle it sits, or it walks over the drawing.
function anchorFor(longitude) {
    const cosine = Math.cos(longitude * RAD);
    if (cosine > 0.35) return "start";
    if (cosine < -0.35) return "end";
    return "middle";
}

function pointAt(longitude, radius) {
    return [
        SKY.center + radius * Math.cos(longitude * RAD),
        SKY.center - radius * Math.sin(longitude * RAD),
    ];
}

function skyMarkup(when, answer, ephemeris) {
    const earth = ephemeris.earthAt(when);
    const mercury = ephemeris.mercuryAt(when);
    const seen = answer.longitude ?? ephemeris.geocentric(when).longitude;

    const pieces = [];
    pieces.push(`<svg viewBox="0 0 ${SKY.size} ${SKY.size}" role="img" `
        + `aria-label="La Tierra y Mercurio alrededor del Sol, con Aries en el cero">`);
    // Rules live here, not in mercury.css: SVG presentation attributes do not
    // resolve var(), a stylesheet does.
    pieces.push(`<style>
        .sky-ring { fill: none; stroke: var(--color-line); stroke-width: 1; }
        .sky-tick { stroke: var(--color-line); stroke-width: 1; }
        .sky-sign { fill: var(--color-text-faint); font-family: var(--font-mono); font-size: 9px; paint-order: stroke; stroke: var(--page-bg); stroke-width: 2.5px; }
        .sky-orbit { fill: none; stroke: var(--color-line-soft); stroke-width: 1; stroke-dasharray: 3 4; }
        .sky-aries { stroke: var(--color-rose); stroke-width: 1; stroke-dasharray: 2 4; opacity: 0.75; }
        .sky-aries-label { fill: var(--color-rose); font-family: var(--font-mono); font-size: 9px; }
        .sky-arc { fill: none; stroke: var(--accent); stroke-width: 5; stroke-linecap: round; }
        .sky-trail { fill: none; stroke: var(--accent); stroke-width: 2; opacity: 0.5; stroke-linecap: round; }
        .sky-arrow { fill: var(--accent); }
        .sky-seen { fill: var(--page-bg); stroke: var(--accent); stroke-width: 2; }
        .sky-limb { stroke: var(--color-text-faint); stroke-width: 0.8; opacity: 0.5; }
        .sky-sun { fill: var(--color-rose); }
        .sky-earth { fill: var(--color-text); }
        .sky-mercury { fill: var(--accent); }
        .sky-name-earth { fill: var(--color-text-soft); font-family: var(--font-mono); font-size: 9px; paint-order: stroke; stroke: var(--page-bg); stroke-width: 3px; }
    </style>`);

    // Zodiac ring: one tick every 30 degrees and the sign names inside.
    pieces.push(`<circle class="sky-ring" cx="${SKY.center}" cy="${SKY.center}" r="${SKY.ring}"/>`);
    for (let index = 0; index < 12; index += 1) {
        const start = pointAt(index * 30, SKY.ring);
        const end = pointAt(index * 30, SKY.ticks);
        pieces.push(`<line class="sky-tick" x1="${start[0].toFixed(1)}" y1="${start[1].toFixed(1)}" `
            + `x2="${end[0].toFixed(1)}" y2="${end[1].toFixed(1)}"/>`);
        const [labelX, labelY] = pointAt(index * 30 + 15, SKY.labels);
        pieces.push(`<text class="sky-sign" x="${labelX.toFixed(1)}" y="${(labelY + 3).toFixed(1)}" `
            + `text-anchor="middle">${SIGNS_SHORT[index]}</text>`);
    }

    // Aries at zero, the reference the whole drawing hangs from.
    const ariesOuter = pointAt(0, SKY.ring);
    pieces.push(`<line class="sky-aries" x1="${SKY.center}" y1="${SKY.center}" `
        + `x2="${ariesOuter[0].toFixed(1)}" y2="${ariesOuter[1].toFixed(1)}"/>`);
    const ariesLabel = pointAt(0, SKY.ticks + 9);
    pieces.push(`<text class="sky-aries-label" x="${ariesLabel[0].toFixed(1)}" `
        + `y="${(ariesLabel[1] + 3).toFixed(1)}" text-anchor="middle">Aries 0°</text>`);

    // Orbits.
    pieces.push(`<circle class="sky-orbit" cx="${SKY.center}" cy="${SKY.center}" r="${SKY.earthOrbit.toFixed(1)}"/>`);
    pieces.push(`<circle class="sky-orbit" cx="${SKY.center}" cy="${SKY.center}" r="${SKY.mercuryOrbit.toFixed(1)}"/>`);

    // The retrograde arc, when the date falls inside one.
    if (answer.start && answer.end) {
        const from = ephemeris.geocentric(answer.start).longitude;
        const to = ephemeris.geocentric(answer.end).longitude;
        let sweep = to - from;
        if (sweep > 0) sweep -= 360;
        const points = [];
        for (let step = 0; step <= 16; step += 1) {
            points.push(pointAt(from + (sweep * step) / 16, SKY.ring));
        }
        pieces.push(`<polyline class="sky-arc" points="${points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}"/>`);
    }

    // The apparent path of the last two weeks, just outside the ring, and an
    // arrowhead pointing the way Mercury is moving right now: forward, stopped,
    // or backwards. Off the ring so it does not sit on top of the arc.
    const trailRadius = SKY.ring + 8;
    const trail = [];
    for (let back = 14; back >= 0; back -= 1) {
        const moment = new Date(when.getTime() - back * DAY_MS);
        trail.push(pointAt(ephemeris.geocentric(moment).longitude, trailRadius));
    }
    pieces.push(`<polyline class="sky-trail" points="${trail
        .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}"/>`);

    const forward = ephemeris.motion(when) > 0 ? 1 : -1;
    const tipAngle = seen + forward * 3.6;
    const [tipX, tipY] = pointAt(tipAngle, trailRadius);
    const [baseAX, baseAY] = pointAt(tipAngle - forward * 4.4, trailRadius - 3.8);
    const [baseBX, baseBY] = pointAt(tipAngle - forward * 4.4, trailRadius + 3.8);
    pieces.push(`<polygon class="sky-arrow" points="${[
        [tipX, tipY], [baseAX, baseAY], [baseBX, baseBY],
    ].map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}"/>`);

    // Where Mercury is seen from Earth: on the ring at its geocentric longitude,
    // which is the degree the text quotes. The straight line joins Earth and
    // Mercury, the planet sitting between us and the Sun.
    const [earthX, earthY] = pointAt(earth.longitude, SKY.earthOrbit);
    const [seenX, seenY] = pointAt(seen, SKY.ring);
    pieces.push(`<circle class="sky-seen" cx="${seenX.toFixed(1)}" cy="${seenY.toFixed(1)}" r="3.6"/>`);

    // Sun, Earth, Mercury.
    pieces.push(`<circle class="sky-sun" cx="${SKY.center}" cy="${SKY.center}" r="6.5"/>`);
    const [mercuryX, mercuryY] = pointAt(mercury.longitude, SKY.mercuryOrbit);
    pieces.push(`<line class="sky-limb" x1="${earthX.toFixed(1)}" y1="${earthY.toFixed(1)}" `
        + `x2="${mercuryX.toFixed(1)}" y2="${mercuryY.toFixed(1)}"/>`);
    pieces.push(`<circle class="sky-earth" cx="${earthX.toFixed(1)}" cy="${earthY.toFixed(1)}" r="4.6"/>`);
    pieces.push(`<circle class="sky-mercury" cx="${mercuryX.toFixed(1)}" cy="${mercuryY.toFixed(1)}" r="3.4"/>`);

    // Earth gets its name just inside its orbit. Mercury does not: its orbit is
    // a third of the size, so any text lands on the Sun or on the sight line.
    // The violet colour is the label, and the legend spells it out.
    const earthLabel = pointAt(earth.longitude, SKY.earthOrbit - 13);
    pieces.push(`<text class="sky-name-earth" x="${earthLabel[0].toFixed(1)}" `
        + `y="${(earthLabel[1] + 3).toFixed(1)}" text-anchor="${anchorFor(earth.longitude)}">Tierra</text>`);

    pieces.push("</svg>");
    return pieces.join("");
}

function renderSky(when, answer, ephemeris) {
    skyNode.innerHTML = skyMarkup(when, answer, ephemeris);
    const grade = answer.retro ? "retrógrado" : "directo";
    const parts = [
        `${dayYearText(when)}. El Sol en el centro, la Tierra y Mercurio donde estaban ese día, `
        + `y Mercurio ${grade} visto desde acá.`,
    ];
    // The arc only exists when the date falls inside a window.
    if (answer.start && answer.end) {
        parts.push("El arco violeta sobre el borde es la retrogradación entera.");
    }
    parts.push("El círculo del borde es dónde se ve Mercurio, en su grado del zodíaco; "
        + "la estela y la flecha, por dónde anduvo y para dónde va ahora. Dale a Reproducir: "
        + "el punto avanza, se frena y vuelve para atrás.");
    skyCaptionNode.textContent = parts.join(" ");
}

// ---------- the chart: the same phenomenon seen from the ground ----------

const CHART = { width: 340, height: 170, left: 42, right: 10, top: 16, bottom: 26, days: 30 };

const shortDayFormat = new Intl.DateTimeFormat("es-PY", { day: "numeric", month: "short" });

// "12° Esc": short enough for the axis, where the full name does not fit.
function shortPlace(longitude) {
    const index = Math.floor((((longitude % 360) + 360) % 360) / 30);
    const degree = (((longitude % 360) + 360) % 360) % 30;
    return `${Math.round(degree)}° ${SIGNS_SHORT[index]}`;
}

// Longitude as seen from Earth, one sample per day for a month either side.
// The values are unwrapped so a pass over 0° Aries draws as a line and not as a
// jump from 359 to 1.
function buildChart(anchor, ephemeris) {
    const samples = [];
    for (let offset = -CHART.days; offset <= CHART.days; offset += 1) {
        const date = new Date(anchor.getTime() + offset * DAY_MS);
        samples.push({ offset, date, longitude: ephemeris.geocentric(date).longitude });
    }
    const unwrapped = [samples[0].longitude];
    for (let index = 1; index < samples.length; index += 1) {
        let delta = samples[index].longitude - samples[index - 1].longitude;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        unwrapped.push(unwrapped[index - 1] + delta);
    }
    const lowest = Math.min(...unwrapped);
    const highest = Math.max(...unwrapped);
    const padding = Math.max(0.5, (highest - lowest) * 0.16);
    return { samples, unwrapped, lowest, highest, floor: lowest - padding, ceiling: highest + padding };
}

// Stretches where the curve goes backwards: what retrograde looks like from here.
function backwardsRuns(chart) {
    const runs = [];
    let current = null;
    for (let index = 1; index < chart.unwrapped.length; index += 1) {
        if (chart.unwrapped[index] < chart.unwrapped[index - 1]) {
            if (current) current.to = index;
            else current = { from: index - 1, to: index };
        } else if (current) {
            runs.push(current);
            current = null;
        }
    }
    if (current) runs.push(current);
    return runs;
}

function renderChart(chart, offsetDays) {
    const { width, height, left, right, top, bottom, days } = CHART;
    const innerWidth = width - left - right;
    const innerHeight = height - top - bottom;
    const x = (offset) => left + ((offset + days) / (days * 2)) * innerWidth;
    const y = (value) => top + ((chart.ceiling - value) / (chart.ceiling - chart.floor)) * innerHeight;

    const point = (index) => `${x(index - days).toFixed(1)} ${y(chart.unwrapped[index]).toFixed(1)}`;
    const curve = chart.unwrapped.map((_, index) => `${index ? "L" : "M"}${point(index)}`).join(" ");

    const pieces = [];
    pieces.push(`<svg viewBox="0 0 ${width} ${height}" role="img" `
        + `aria-label="Posición de Mercurio vista desde la Tierra a lo largo de dos meses">`);
    pieces.push(`<style>
        .chart-axis { stroke: var(--color-line); stroke-width: 1; }
        .chart-grid { stroke: var(--color-line-soft); stroke-width: 1; stroke-dasharray: 2 4; }
        .chart-curve { fill: none; stroke: var(--color-text-soft); stroke-width: 1.6; }
        .chart-band { fill: var(--accent); opacity: 0.07; }
        .chart-back { fill: none; stroke: var(--accent); stroke-width: 3; stroke-linecap: round; }
        .chart-station { fill: var(--accent); }
        .chart-mark { stroke: var(--color-rose); stroke-width: 1; stroke-dasharray: 3 3; }
        .chart-mark-dot { fill: var(--color-rose); }
        .chart-mark-dot.is-back { fill: var(--accent); }
        .chart-label { fill: var(--color-text-faint); font-family: var(--font-mono); font-size: 7px; }
        .chart-label.is-strong { fill: var(--color-text-soft); }
    </style>`);

    // The two gridlines carry the extremes of the curve, labelled with the sign.
    const highestIndex = chart.unwrapped.indexOf(chart.highest);
    const lowestIndex = chart.unwrapped.indexOf(chart.lowest);
    for (const [index, value] of [[highestIndex, chart.highest], [lowestIndex, chart.lowest]]) {
        const lineY = y(value).toFixed(1);
        pieces.push(`<line class="chart-grid" x1="${left}" y1="${lineY}" x2="${width - right}" y2="${lineY}"/>`);
        pieces.push(`<text class="chart-label" x="2" y="${(Number(lineY) + 2.4).toFixed(1)}">`
            + `${shortPlace(chart.samples[index].longitude)}</text>`);
    }

    pieces.push(`<line class="chart-axis" x1="${left}" y1="${height - bottom}" `
        + `x2="${width - right}" y2="${height - bottom}"/>`);

    // A band under each retrograde stretch, drawn first so the curve sits on it.
    const runs = backwardsRuns(chart);
    for (const run of runs) {
        const bandLeft = x(run.from - days);
        const bandRight = x(run.to - days);
        pieces.push(`<rect class="chart-band" x="${bandLeft.toFixed(1)}" y="${top - 2}" `
            + `width="${Math.max(1, bandRight - bandLeft).toFixed(1)}" height="${innerHeight + 4}"/>`);
    }

    pieces.push(`<path class="chart-curve" d="${curve}"/>`);
    for (const run of runs) {
        const from = Math.max(0, run.from - 1);
        const to = Math.min(chart.unwrapped.length - 1, run.to + 1);
        const segment = chart.unwrapped.slice(from, to + 1)
            .map((_, index) => `${index ? "L" : "M"}${point(from + index)}`).join(" ");
        pieces.push(`<path class="chart-back" d="${segment}"/>`);
        for (const edge of [run.from, run.to]) {
            pieces.push(`<circle class="chart-station" cx="${x(edge - days).toFixed(1)}" `
                + `cy="${y(chart.unwrapped[edge]).toFixed(1)}" r="2.2"/>`);
        }
    }

    // Dates on the axis: the two ends and the anchor.
    const axisY = height - bottom + 11;
    for (const [offset, anchorStrong] of [[-days, false], [0, true], [days, false]]) {
        const label = shortDayFormat.format(chart.samples[offset + days].date);
        const anchor = offset < 0 ? "start" : offset > 0 ? "end" : "middle";
        pieces.push(`<text class="chart-label${anchorStrong ? " is-strong" : ""}" `
            + `x="${x(offset).toFixed(1)}" y="${axisY}" text-anchor="${anchor}">${label}</text>`);
    }

    // The day the reader is looking at.
    const markerIndex = Math.max(0, Math.min(chart.samples.length - 1, offsetDays + days));
    const markerX = x(offsetDays).toFixed(1);
    const markerY = y(chart.unwrapped[markerIndex]).toFixed(1);
    const inRetrograde = runs.some((run) => markerIndex >= run.from && markerIndex <= run.to);
    pieces.push(`<line class="chart-mark" x1="${markerX}" y1="${top - 4}" x2="${markerX}" y2="${height - bottom}"/>`);
    pieces.push(`<circle class="chart-mark-dot${inRetrograde ? " is-back" : ""}" cx="${markerX}" cy="${markerY}" r="3.4"/>`);

    pieces.push("</svg>");
    chartNode.innerHTML = pieces.join("");

    const start = chart.samples[0].date;
    const end = chart.samples[chart.samples.length - 1].date;
    chartCaptionNode.textContent = `Del ${dayText(start)} al ${dayText(end)}, la posición de Mercurio `
        + `vista desde la Tierra. Cuando la curva baja, está retrógrado: no se da vuelta el planeta, `
        + `se lo ve así desde acá.`;
}

// ---------- boot ----------

async function boot() {
    let payload;
    let ephemeris = null;
    try {
        const [tableResponse, ephemerisTable] = await Promise.all([
            fetch("./data/retrograde.json"),
            loadEphemeris("./data/vsop87.json"),
        ]);
        if (!tableResponse.ok) throw new Error(`HTTP ${tableResponse.status}`);
        payload = await tableResponse.json();
        ephemeris = ephemerisTable;
    } catch (error) {
        statusNode.dataset.state = "unknown";
        stateNode.textContent = "No pude leer la tabla";
        whenNode.textContent = "El archivo de datos no cargó. Recargá la página; si sigue, falta el JSON.";
        listNode.replaceChildren();
        return;
    }

    const windows = prepare(payload);
    const now = new Date();

    renderStatus(windows, now);
    renderList(windows, now, false);
    renderMap(windows, now);

    rangeNode.textContent = `${payload.first_year} y ${payload.last_year}`;
    generatedNode.textContent = `Tabla generada el ${dayYearText(new Date(payload.generated))}, `
        + `${windows.length} retrogradaciones.`;

    moreNode.hidden = false;
    let showingPast = false;
    moreNode.addEventListener("click", () => {
        showingPast = !showingPast;
        renderList(windows, now, showingPast);
        moreNode.textContent = showingPast ? "Ver solo las que vienen" : "Ver las que ya pasaron";
    });

    // The date field is the anchor; the scrubber walks up to a month either
    // side of it without moving the anchor, so the chart and the two ends of the
    // slider stay where the reader put them.
    const localDateValue = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    };

    let anchor = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
    let offset = 0;
    let chart = buildChart(anchor, ephemeris);

    function paintEnds() {
        scrubStartNode.textContent = shortDayFormat.format(new Date(anchor.getTime() - CHART.days * DAY_MS));
        scrubEndNode.textContent = shortDayFormat.format(new Date(anchor.getTime() + CHART.days * DAY_MS));
    }

    function render() {
        const when = new Date(anchor.getTime() + offset * DAY_MS);
        const answer = resolve(when, windows, ephemeris);
        const shift = offset === 0 ? "" : ` · ${offset > 0 ? "+" : ""}${offset} días`;
        scrubValueNode.textContent = `${dayYearText(when)}${shift}`;
        renderDateAnswer(when, answer);
        renderSky(when, answer, ephemeris);
        renderChart(chart, offset);
    }

    function setAnchor(value) {
        const parsed = new Date(`${value}T12:00:00`);
        if (Number.isNaN(parsed.getTime())) {
            dateAnswerNode.textContent = "Esa fecha no se entiende.";
            return;
        }
        anchor = parsed;
        offset = 0;
        scrubNode.value = "0";
        chart = buildChart(anchor, ephemeris);
        paintEnds();
        render();
    }

    dateInput.value = localDateValue(anchor);
    paintEnds();
    render();

    dateForm.addEventListener("submit", (event) => {
        event.preventDefault();
        stopPlayback();
        setAnchor(dateInput.value);
    });
    dateInput.addEventListener("change", () => {
        stopPlayback();
        setAnchor(dateInput.value);
    });
    dateTodayButton.addEventListener("click", () => {
        stopPlayback();
        const today = new Date();
        const local = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0, 0);
        dateInput.value = localDateValue(local);
        setAnchor(dateInput.value);
    });
    scrubNode.addEventListener("input", () => {
        stopPlayback();
        offset = Number(scrubNode.value) || 0;
        render();
    });

    // Playback: the marker walks the month one day at a time, which is the only
    // way the reversal reads as a movement instead of as a shape.
    let frame = null;
    let playing = false;
    let lastTick = 0;
    const STEP_MS = 170;

    function stopPlayback() {
        if (!playing && !frame) return;
        playing = false;
        if (frame) cancelAnimationFrame(frame);
        frame = null;
        playNode.setAttribute("aria-pressed", "false");
        playNode.textContent = "Reproducir el mes";
    }

    function tick(timestamp) {
        if (!playing) return;
        if (!lastTick) lastTick = timestamp;
        if (timestamp - lastTick >= STEP_MS) {
            lastTick = timestamp;
            offset = Math.min(CHART.days, offset + 1);
            scrubNode.value = String(offset);
            render();
            if (offset >= CHART.days) {
                stopPlayback();
                return;
            }
        }
        frame = requestAnimationFrame(tick);
    }

    playNode.addEventListener("click", () => {
        if (playing) {
            stopPlayback();
            return;
        }
        if (offset >= CHART.days) offset = -CHART.days;
        playing = true;
        lastTick = 0;
        playNode.setAttribute("aria-pressed", "true");
        playNode.textContent = "Pausa";
        frame = requestAnimationFrame(tick);
    });
}

boot();
