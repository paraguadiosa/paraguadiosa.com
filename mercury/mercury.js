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
const skyNode = document.getElementById("mercury-sky");
const skyCaptionNode = document.getElementById("mercury-sky-caption");

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
        .sky-sight { stroke: var(--accent); stroke-width: 1.2; stroke-dasharray: 4 3; opacity: 0.8; }
        .sky-seen { fill: none; stroke: var(--accent); stroke-width: 1.6; }
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

    // Where Mercury looks like it is from Earth: the line leaves the Earth dot
    // in the direction of the geocentric longitude and stops at the ring.
    const [earthX, earthY] = pointAt(earth.longitude, SKY.earthOrbit);
    const directionX = Math.cos(seen * RAD);
    const directionY = -Math.sin(seen * RAD);
    const fromCenter = (earthX - SKY.center) * directionX + (earthY - SKY.center) * directionY;
    const inside = SKY.earthOrbit * SKY.earthOrbit - SKY.ring * SKY.ring;
    const reach = -fromCenter + Math.sqrt(Math.max(0, fromCenter * fromCenter - inside));
    const sightX = earthX + directionX * reach;
    const sightY = earthY + directionY * reach;

    pieces.push(`<line class="sky-sight" x1="${earthX.toFixed(1)}" y1="${earthY.toFixed(1)}" `
        + `x2="${sightX.toFixed(1)}" y2="${sightY.toFixed(1)}"/>`);
    pieces.push(`<circle class="sky-seen" cx="${sightX.toFixed(1)}" cy="${sightY.toFixed(1)}" r="3.2"/>`);

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
    skyCaptionNode.textContent = `${dayYearText(when)}. El Sol en el centro, la Tierra y Mercurio `
        + `donde estaban ese día, y Mercurio ${grade} visto desde acá. `
        + `El arco violeta sobre el borde es la retrogradación entera.`;
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

    // The date picker: today by default, then whatever the reader asks for.
    const localDateValue = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    };

    function showDate(value) {
        const when = new Date(`${value}T12:00:00`);
        if (Number.isNaN(when.getTime())) {
            dateAnswerNode.textContent = "Esa fecha no se entiende.";
            return;
        }
        const answer = resolve(when, windows, ephemeris);
        renderDateAnswer(when, answer);
        renderSky(when, answer, ephemeris);
    }

    dateInput.value = localDateValue(now);
    showDate(dateInput.value);

    dateForm.addEventListener("submit", (event) => {
        event.preventDefault();
        showDate(dateInput.value);
    });
    dateInput.addEventListener("change", () => showDate(dateInput.value));
    dateTodayButton.addEventListener("click", () => {
        dateInput.value = localDateValue(new Date());
        showDate(dateInput.value);
    });
}

boot();
