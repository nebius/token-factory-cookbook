"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import type { DocKey } from "@/lib/book";
import type { Box } from "@/lib/pdf";

export type ViewerDoc = { key: DocKey; name: string; pages: number; sizes: [number, number][]; scanned: number[]; used: number[] };

export type Highlight = { box?: Box; lines?: Box[]; chart?: boolean; caption?: string };

export { distinctNames } from "@/lib/doc-names";
import { distinctNames } from "@/lib/doc-names";

function place(b: Box) {
  return { left: `${(b[0] - 0.004) * 100}%`, top: `${(b[1] - 0.003) * 100}%`, width: `${(b[2] + 0.008) * 100}%`, height: `${(b[3] + 0.006) * 100}%` };
}

// The document page beside the sheet, with the cited number or quote highlighted.
// With two documents, a switcher picks which one is shown; clicking a cell switches to its document.
export function PageViewer({ runId, docs, doc, page, onPage, highlight }: { runId: string; docs: ViewerDoc[]; doc: DocKey; page: number; onPage: (doc: DocKey, n: number) => void; highlight?: Highlight }) {
  const current = docs.find((d) => d.key === doc) ?? docs[0];
  const { pages, sizes, used } = current;
  const scanned = current.scanned.includes(page);
  const frame = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [typed, setTyped] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [reading, setReading] = useState<{ src: string; lines: string[]; fileText: string | null } | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const src = `/api/runs/${runId}/pages/${page}${current.key === "B" ? "?doc=B" : ""}`;
  const [w, h] = sizes[page - 1] ?? [612, 792];

  // A cached image can finish loading before React attaches onLoad.
  useEffect(() => {
    if (img.current?.complete && img.current.naturalWidth) setLoaded(src);
  }, [src]);

  // A new page without a highlight starts at its top.
  useEffect(() => {
    if (!highlight?.box) frame.current?.scrollTo({ top: 0 });
  }, [src, highlight?.box]);

  // Keep the current page's chip visible in the strip.
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>("[aria-current='page']")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [page]);

  useEffect(() => {
    // Bring the highlight into view inside the scrolling frame.
    if (!mark.current || !frame.current || loaded !== src) return;
    const f = frame.current;
    const top = mark.current.offsetTop - f.clientHeight / 3;
    const left = mark.current.offsetLeft - f.clientWidth / 3;
    f.scrollTo({ top: Math.max(0, top), left: Math.max(0, left), behavior: "smooth" });
  }, [highlight, loaded, src, zoom]);

  if (!pages) return null;
  return (
    <div className="viewer">
      {docs.length > 1 && (
        <div className="doc-switch" role="tablist" aria-label="Document">
          {docs.map((d) => (
            <button key={d.key} role="tab" aria-selected={d.key === current.key} className="doc-tab" onClick={() => onPage(d.key, d.key === current.key ? page : (d.used[0] ?? 1))} title={d.name}>
              <span className="doc-key">{d.key}</span>
              <span className="doc-name">{distinctNames(docs.map((x) => x.name))[docs.indexOf(d)]}</span>
            </button>
          ))}
        </div>
      )}
      <div className="viewer-bar">
        <form
          className="small goto"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(typed);
            if (Number.isInteger(n) && n >= 1 && n <= pages) onPage(current.key, n);
            setTyped(null);
          }}
        >
          <label htmlFor="goto-page">Page</label>
          <input
            id="goto-page"
            type="text"
            inputMode="numeric"
            value={typed ?? String(page)}
            onChange={(e) => setTyped(e.target.value.replace(/\D/g, "").slice(0, 4))}
            onFocus={(e) => e.target.select()}
            onBlur={(e) => e.currentTarget.form?.requestSubmit()}
            aria-label={`Page number, 1 to ${pages}`}
          />
          <span className="faint">of {pages}</span>
        </form>
        <div className="pager">
          <button className="icon-btn" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(current.key, page - 1)}>
            <Icon name="back" size={14} />
          </button>
          <button className="icon-btn" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(current.key, page + 1)} style={{ transform: "scaleX(-1)" }}>
            <Icon name="back" size={14} />
          </button>
          <button className="icon-btn zoom" aria-label={zoom > 1 ? "Fit the page to the panel" : "Zoom in to read small print"} aria-pressed={zoom > 1} onClick={() => setZoom(zoom > 1 ? 1 : 2.2)}>
            {zoom > 1 ? "1×" : "2×"}
          </button>
          <a className="icon-btn" aria-label="Open the page image" href={src} target="_blank" rel="noreferrer">
            <Icon name="eye" size={14} />
          </a>
        </div>
      </div>
      {used.length > 1 && pages > 6 && (
        <div className="used" ref={strip} aria-label="Pages the model used">
          <span className="faint caption">Used</span>
          {used.map((n) => (
            <button key={n} className="used-page" aria-current={n === page ? "page" : undefined} onClick={() => onPage(current.key, n)}>
              {n}
            </button>
          ))}
        </div>
      )}
      {scanned && (
        <div className="scan-note small" role="note">
          <span>Scanned page. Its text was read by the model from this image, so checks on it compare against the model&apos;s reading, not the PDF&apos;s text.</span>
          <button
            className="page-link"
            onClick={async () => {
              if (reading?.src === src) return setReading(null);
              const r = await fetch(`/api/runs/${runId}/text/${page}${current.key === "B" ? "?doc=B" : ""}`).then((x) => x.json());
              setReading({ src, lines: r.lines ?? [], fileText: r.fileText ?? null });
            }}
          >
            {reading?.src === src ? "Hide the model's reading" : "Show the model's reading"}
          </button>
        </div>
      )}
      {scanned && reading?.src === src && (
        <div className="reading">
          <pre className="code wrap">{reading.lines.join("\n")}</pre>
          {reading.fileText && (
            <details>
              <summary>The file&apos;s own OCR layer, for comparison</summary>
              <pre className="code wrap" style={{ marginTop: 8 }}>
                {reading.fileText}
              </pre>
            </details>
          )}
        </div>
      )}
      <div className="page-frame" ref={frame}>
        <div style={{ position: "relative", width: `${zoom * 100}%` }}>
          {loaded !== src && <div className="ph" style={{ aspectRatio: `${w} / ${h}` }}>Rendering page {page}…</div>}
          <img ref={img} key={src} src={src} alt={`Page ${page}`} onLoad={() => setLoaded(src)} style={loaded === src ? undefined : { position: "absolute", inset: 0, opacity: 0 }} />
          {loaded === src &&
            highlight?.lines?.map((b, i) => <div key={i} className="hl-line" style={place(b)} />)}
          {highlight?.box && loaded === src && <div ref={mark} className={`hl${highlight.chart ? " chart" : ""}`} style={place(highlight.box)} />}
        </div>
      </div>
      {highlight?.caption && <p className="faint caption" style={{ margin: 0 }}>{highlight.caption}</p>}
    </div>
  );
}
