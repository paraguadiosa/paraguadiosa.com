// simple.js
// Fallback reader: renders the book without the paginator's iframe.
//
// iOS Safari turns the paginator's iframe navigation into a download of the
// spine document (an .xhtml file), whatever MIME the blob carries, so on that
// path nothing ever renders. Here the EPUB is read with the same vendored zip
// reader, each document is parsed and cloned into an open shadow root (so the
// book's CSS cannot leak into the page and images still resolve), and the
// navigation moves between documents with native scrolling.

import {
    configure,
    ZipReader,
    BlobReader,
    TextWriter,
    BlobWriter,
} from "../vendor/foliate/vendor/zip.js";

const XHTML = new Set(["application/xhtml+xml", "text/html"]);

configure({ useWebWorkers: false });

const dirname = (path) => path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";

function parseXml(text) {
    return new DOMParser().parseFromString(text, "application/xml");
}

function resolve(base, href) {
    if (!href || /^[a-z]+:/i.test(href)) return href;
    const stack = (base + href).split("/");
    const out = [];
    for (const part of stack) {
        if (part === "." || part === "") continue;
        if (part === "..") out.pop();
        else out.push(part);
    }
    return out.join("/");
}

async function openEpub(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`no pude bajar el libro (${response.status})`);
    const blob = await response.blob();
    const zip = new ZipReader(new BlobReader(blob));
    const entries = new Map((await zip.getEntries()).map((entry) => [entry.filename, entry]));

    const readText = async (name) => {
        const entry = entries.get(name);
        if (!entry) throw new Error(`falta ${name} en el libro`);
        return entry.getData(new TextWriter());
    };

    const container = parseXml(await readText("META-INF/container.xml"));
    const opfPath = container.querySelector("rootfile")?.getAttribute("full-path");
    if (!opfPath) throw new Error("el libro no declara su paquete");
    const opf = parseXml(await readText(opfPath));
    const base = dirname(opfPath);

    const manifest = new Map();
    for (const item of opf.querySelectorAll("manifest > item")) {
        manifest.set(item.getAttribute("id"), {
            href: resolve(base, item.getAttribute("href")),
            type: item.getAttribute("media-type") ?? "",
        });
    }

    const spine = [];
    for (const itemref of opf.querySelectorAll("spine > itemref")) {
        const item = manifest.get(itemref.getAttribute("idref"));
        if (item) spine.push(item);
    }

    return { zip, entries, manifest, spine, readText };
}

export async function renderSimple(book, container, { onProgress } = {}) {
    const root = container.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
        :host { display: block; height: 100%; overflow-y: auto; background: #f7f2e7; color: #241d12; }
        .page { max-width: 680px; margin: 0 auto; padding: 28px 20px 56px; }
        .page img { max-width: 100%; height: auto; }
        .page a { color: #5b3fa8; }
        @media (max-width: 640px) { .page { padding: 18px 12px 44px; } }
    `;
    root.append(style);

    const pages = document.createElement("div");
    pages.className = "page";
    root.append(pages);

    const blobs = new Map();
    const blobUrl = async (path) => {
        if (blobs.has(path)) return blobs.get(path);
        const entry = book.entries.get(path);
        if (!entry) return null;
        const data = await entry.getData(new BlobWriter(guessType(path)));
        const url = URL.createObjectURL(data);
        blobs.set(path, url);
        return url;
    };

    const bookCss = await loadBookCss(book, blobUrl);
    if (bookCss) {
        const bookStyle = document.createElement("style");
        bookStyle.textContent = bookCss;
        root.append(bookStyle);
    }

    let index = 0;

    const show = async (next) => {
        index = Math.max(0, Math.min(next, book.spine.length - 1));
        const item = book.spine[index];
        const text = await book.readText(item.href);
        const doc = new DOMParser().parseFromString(text, "text/html");
        const body = doc.body ?? doc.documentElement;

        // Resolve every relative reference against the document's own folder.
        const base = dirname(item.href);
        for (const el of body.querySelectorAll("[src], [href]")) {
            for (const attribute of ["src", "href", "xlink:href"]) {
                const value = el.getAttribute(attribute);
                if (!value || /^(#|data:|https?:|mailto:)/i.test(value)) continue;
                const path = resolve(base, value.split("#")[0]);
                const url = await blobUrl(path);
                if (url) el.setAttribute(attribute, url);
            }
        }
        for (const anchor of body.querySelectorAll("a[href]")) {
            anchor.addEventListener("click", (event) => {
                const href = anchor.getAttribute("href") ?? "";
                if (!href.includes("#")) return;
                const target = body.querySelector(`[id="${href.split("#")[1]}"]`)
                    ?? body.querySelector(`[name="${href.split("#")[1]}"]`);
                if (!target) return;
                event.preventDefault();
                target.scrollIntoView({ block: "start" });
            });
        }

        pages.replaceChildren(...Array.from(body.childNodes, (node) => node.cloneNode(true)));
        root.querySelector(".page")?.scrollIntoView?.({ block: "start" });
        root.scrollTop = 0;
        container.scrollIntoView?.({ block: "nearest" });

        if (onProgress) onProgress(index, book.spine.length, body.textContent ?? "");
    };

    return {
        show,
        next: () => show(index + 1),
        prev: () => show(index - 1),
        get index() { return index; },
        get total() { return book.spine.length; },
    };
}

function guessType(path) {
    if (/\.x?html?$/i.test(path)) return "text/html";
    if (/\.css$/i.test(path)) return "text/css";
    if (/\.svg$/i.test(path)) return "image/svg+xml";
    if (/\.png$/i.test(path)) return "image/png";
    if (/\.gif$/i.test(path)) return "image/gif";
    if (/\.jpe?g$/i.test(path)) return "image/jpeg";
    if (/\.woff2?$/i.test(path)) return "font/woff2";
    if (/\.ttf$/i.test(path)) return "font/ttf";
    return "application/octet-stream";
}

async function loadBookCss(book, blobUrl) {
    const sheets = [...book.manifest.values()].filter((item) => item.type === "text/css");
    const chunks = [];
    for (const sheet of sheets) {
        try {
            chunks.push(await book.readText(sheet.href));
        } catch (error) {
            // A missing stylesheet is not worth failing the reader over.
        }
    }
    // Point url(...) references at blobs of the same archive.
    const joined = chunks.join("\n");
    const urls = [...joined.matchAll(/url\((['"]?)([^'")]+)\1\)/g)];
    let css = joined;
    for (const [match, , raw] of urls) {
        if (/^(data:|https?:)/i.test(raw)) continue;
        const path = resolve("", raw);
        const blob = await blobUrl(path);
        if (blob) css = css.replace(match, `url("${blob}")`);
    }
    return css;
}

export { openEpub };
