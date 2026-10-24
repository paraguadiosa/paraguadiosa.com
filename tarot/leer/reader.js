// reader.js
// EPUB reader for the tarot book page. Opens the committed EPUB with the
// vendored foliate-js and keeps the reading position in localStorage.
// Static site: no backend, no tracking, nothing leaves the device.

import "../vendor/foliate/view.js";

const BOOK_PATH = "../data/rider-waite-es.epub";
const STORE_KEY = "tarot-reader-cfi";

// On a phone there is no console. With ?probe=1 the reader reports each step to
// the server, so a device-only failure can be read in the access log.
const PROBE = new URLSearchParams(location.search).has("probe");

function report(step, extra = {}) {
    if (!PROBE) return;
    const params = new URLSearchParams({ step, ...extra });
    fetch(`/_probe?${params}`, { cache: "no-store", keepalive: true }).catch(() => {});
}

const view = document.getElementById("reader-view");
const status = document.getElementById("reader-status");
const prevButton = document.getElementById("reader-prev");
const nextButton = document.getElementById("reader-next");
const progress = document.getElementById("reader-progress");
const progressFill = document.getElementById("reader-progress-fill");
const pctLabel = document.getElementById("reader-pct");

// foliate reads this.book in goLeft/goRight, and this.book only exists once
// open() has fetched and unzipped the EPUB. On a phone that takes a moment, and
// a tap in the meantime throws "undefined is not an object (this.book.dir)".
let ready = false;

function setControls(enabled) {
    ready = enabled;
    prevButton.disabled = !enabled;
    nextButton.disabled = !enabled;
}

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

// Safari (WebKit) downloads a document instead of rendering it when the iframe
// navigates to a blob typed application/xhtml+xml, which is what foliate hands
// to the paginator for every spine item. Reported on iOS as "it downloads an
// .xhtml file" with a blank reader. The bytes are the same; serving them as
// text/html keeps Chromium and WebKit on the same path.
const XHTML = "application/xhtml+xml";
let seenDocuments = 0;

function documentsAsHTML(book) {
    const target = book?.transformTarget;
    if (!target) return;
    target.addEventListener("data", (event) => {
        if (event.detail?.type !== XHTML) return;
        event.detail.type = "text/html";
        if (seenDocuments < 3) {
            seenDocuments += 1;
            report("document", { n: String(seenDocuments), type: "text/html" });
        }
    });
}

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
    report("error", { message: String(error?.message ?? error).slice(0, 80) });
    setControls(false);
    status.hidden = false;
    status.textContent = "No se pudo abrir el libro. Recargá la página.";
}

async function start() {
    try {
        report("start");
        await view.open(new URL(BOOK_PATH, import.meta.url).href);
        report("opened", {
            sections: String(view.book?.sections?.length ?? 0),
            target: String(!!view.book?.transformTarget),
        });
        documentsAsHTML(view.book);
        applyLayout();
        await view.init({ lastLocation: store.read() ?? undefined, showTextStart: true });
        report("init");
        setControls(true);
        status.hidden = true;
    } catch (error) {
        fail(error);
    }
}

view.addEventListener("load", ({ detail }) => {
    report("load", { index: String(detail?.index ?? "") });
    status.hidden = true;
});

view.addEventListener("relocate", ({ detail }) => {
    setProgress(detail?.fraction);
    if (detail?.cfi) store.write(detail.cfi);
    report("relocate", { pct: String(Math.round((detail?.fraction ?? 0) * 100)) });
});

prevButton.addEventListener("click", () => {
    if (!ready) return;
    view.goLeft();
});
nextButton.addEventListener("click", () => {
    if (!ready) return;
    view.goRight();
});

document.addEventListener("keydown", (event) => {
    if (!ready || event.altKey || event.ctrlKey || event.metaKey) return;
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

setControls(false);
start();
