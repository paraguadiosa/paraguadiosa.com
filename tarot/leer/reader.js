// reader.js
// EPUB reader for the tarot book page. Opens the committed EPUB with the
// vendored foliate-js and keeps the reading position in localStorage.
// Static site: no backend, no tracking, nothing leaves the device.

import "../vendor/foliate/view.js";

const BOOK_PATH = "../data/rider-waite-es.epub";
const STORE_KEY = "tarot-reader-cfi";

const view = document.getElementById("reader-view");
const status = document.getElementById("reader-status");
const prevButton = document.getElementById("reader-prev");
const nextButton = document.getElementById("reader-next");
const progress = document.getElementById("reader-progress");
const progressFill = document.getElementById("reader-progress-fill");
const pctLabel = document.getElementById("reader-pct");

const store = {
    read() {
        try {
            return localStorage.getItem(STORE_KEY);
        } catch (error) {
            return null;
        }
    },
    write(value) {
        try {
            localStorage.setItem(STORE_KEY, value);
        } catch (error) {
            // Private mode or a full quota: reading still works, progress is not kept.
        }
    },
};

// Narrow screens get tighter margins so the card images stay legible.
function applyLayout() {
    const renderer = view.renderer;
    if (!renderer) return;
    const narrow = window.innerWidth < 640;
    renderer.setAttribute("max-inline-size", narrow ? "100%" : "680px");
    renderer.setAttribute("margin", narrow ? "12px" : "24px");
}

function setProgress(fraction) {
    const pct = Math.round((fraction ?? 0) * 100);
    progressFill.style.width = `${pct}%`;
    progress.setAttribute("aria-valuenow", String(pct));
    pctLabel.textContent = `${pct}%`;
}

function fail(error) {
    console.error(error);
    status.hidden = false;
    status.textContent = "No se pudo abrir el libro. Recargá la página.";
}

async function start() {
    try {
        await view.open(new URL(BOOK_PATH, import.meta.url).href);
        applyLayout();
        await view.init({ lastLocation: store.read() ?? undefined, showTextStart: true });
        status.hidden = true;
    } catch (error) {
        fail(error);
    }
}

view.addEventListener("load", () => {
    status.hidden = true;
});

view.addEventListener("relocate", ({ detail }) => {
    setProgress(detail?.fraction);
    if (detail?.cfi) store.write(detail.cfi);
});

prevButton.addEventListener("click", () => view.goLeft());
nextButton.addEventListener("click", () => view.goRight());

document.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
        event.preventDefault();
        view.goRight();
    } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        view.goLeft();
    }
});

// Keep the reading position when the tab is closed or the page is hidden.
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && view.lastLocation?.cfi) {
        store.write(view.lastLocation.cfi);
    }
});

window.addEventListener("resize", applyLayout);

start();
