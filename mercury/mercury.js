// mercury.js
// Reads mercury/data/retrograde.json (built by scripts/build_mercury.py) and
// answers the only question this page has: is Mercury retrograde now, and when
// does the next one start. No model, no backend, no API.
//
// The table stores instants in UTC. Everything shown here is in the reader's
// own timezone, because "empieza el 13" is useless if it starts at 23:40.

const SIGNS_ES = [
    "Aries", "Tauro", "Géminis", "Cáncer", "Leo", "Virgo",
    "Libra", "Escorpio", "Sagitario", "Capricornio", "Acuario", "Piscis",
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

const dayFormat = new Intl.DateTimeFormat("es-PY", { day: "numeric", month: "long" });
const dayYearFormat = new Intl.DateTimeFormat("es-PY", { day: "numeric", month: "long", year: "numeric" });
const timeFormat = new Intl.DateTimeFormat("es-PY", { hour: "2-digit", minute: "2-digit" });

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

// ---------- text helpers ----------

function dayText(date) {
    return dayFormat.format(date);
}

function dayYearText(date) {
    return dayYearFormat.format(date);
}

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

function spanText(station) {
    return `de ${degreeText(station.degree)} de ${SIGNS_ES[station.index]}`;
}

function stationPair(window) {
    return `${degreeText(window.retrograde.degree)} de ${SIGNS_ES[window.retrograde.index]}`
        + ` a ${degreeText(window.direct.degree)} de ${SIGNS_ES[window.direct.index]}`;
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

// ---------- rendering ----------

function renderStatus(windows, now) {
    const state = stateOf(windows, now);

    if (state.kind === "retro") {
        const { current } = state;
        statusNode.dataset.state = "retro";
        stateNode.textContent = "Mercurio está retrógrado";
        const total = Math.max(1, Math.ceil(current.days));
        const elapsed = Math.max(0, Math.floor((now - current.start) / DAY_MS));
        whenNode.textContent = `Día ${Math.min(elapsed + 1, total)} de ${total}. Vuelve a directo el `
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

// ---------- boot ----------

async function boot() {
    let payload;
    try {
        const response = await fetch("./data/retrograde.json");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        payload = await response.json();
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
}

boot();
