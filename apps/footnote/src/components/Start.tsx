"use client";

import { pairTitle } from "@/lib/doc-names";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import type { Example } from "@/lib/examples";

const MAX_MB = 40;

type Mode = "one" | "compare";
// A compare slot holds an uploaded file or a bundled example.
type Slot = { file: File } | { example: string } | null;

function Drop({ label, slot, examples, onPick, onError }: { label: string; slot: Slot; examples?: Example[]; onPick: (s: Slot) => void; onError: (e: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const file = slot && "file" in slot ? slot.file : null;
  const ex = slot && "example" in slot ? examples?.find((e) => e.id === slot.example) : undefined;

  function pick(f: File | undefined) {
    if (!f) return;
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) return onError("That file is not a PDF.");
    if (f.size > MAX_MB * 1024 * 1024) return onError(`PDFs up to ${MAX_MB} MB.`);
    onPick({ file: f });
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div
        className={`drop${over ? " over" : ""}${slot ? " has-file" : ""}`}
        role="button"
        tabIndex={0}
        aria-label={`${label}: drop a PDF or click to choose`}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), input.current?.click())}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          pick(e.dataTransfer.files[0]);
        }}
      >
        <Icon name="upload" size={22} />
        {file ? (
          <>
            <strong style={{ overflowWrap: "anywhere" }}>{file.name}</strong>
            <span className="faint small">{(file.size / 1024 / 1024).toFixed(1)} MB · click to choose another</span>
          </>
        ) : ex ? (
          <>
            <strong style={{ overflowWrap: "anywhere" }}>{ex.name}</strong>
            <span className="faint small">Bundled example · click to upload a PDF instead</span>
          </>
        ) : (
          <>
            <strong>{examples ? `${label}: drop a PDF, or click to choose` : "Drop a PDF here, or click to choose"}</strong>
            <span className="faint small">Reports, filings, research notes and decks, scanned or born digital. Up to {MAX_MB} MB and 120 pages.</span>
          </>
        )}
        <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => pick(e.target.files?.[0])} />
      </div>
      {examples && (
        <label className="field">
          <span className="faint caption">Or use a bundled document as {label}</span>
          <select className="select" value={ex?.id ?? ""} onChange={(e) => onPick(e.target.value ? { example: e.target.value } : null)}>
            <option value="">None</option>
            {examples.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

export function Start({ examples, sandbox }: { examples: Example[]; sandbox: string | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("one");
  const [one, setOne] = useState<Slot>(null);
  const [a, setA] = useState<Slot>(null);
  const [b, setB] = useState<Slot>(null);
  const [focus, setFocus] = useState("");
  const [python, setPython] = useState(sandbox !== null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const singles = examples.filter((e) => !e.b);
  const pairs = examples.filter((e) => e.b);

  async function go(body: FormData | object, key: string) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch("/api/runs", body instanceof FormData ? { method: "POST", body } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? `Request failed (${res.status})`);
      router.push(`/run/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  function start() {
    setError(null);
    if (mode === "one") {
      if (!one || !("file" in one)) return setError("Choose a PDF first.");
      const form = new FormData();
      form.set("pdf", one.file);
      form.set("focus", focus);
      form.set("python", python ? "on" : "off");
      return void go(form, "upload");
    }
    if (!a || !b) return setError("Choose both documents, A and B.");
    if ("example" in a && "example" in b) return void go({ examples: [a.example, b.example], python, focus }, "upload");
    if ("file" in a && "file" in b) {
      const form = new FormData();
      form.set("pdf", a.file);
      form.set("pdfB", b.file);
      form.set("focus", focus);
      form.set("python", python ? "on" : "off");
      return void go(form, "upload");
    }
    setError("Use two uploads or two bundled documents.");
  }

  const ready = mode === "one" ? !!one : !!a && !!b;

  return (
    <div className="start">
      <section className="card stack">
        <div className="seg" role="tablist" aria-label="What to read">
          <button role="tab" className="sheet-tab" aria-selected={mode === "one"} onClick={() => setMode("one")}>
            One document
          </button>
          <button role="tab" className="sheet-tab" aria-selected={mode === "compare"} onClick={() => setMode("compare")}>
            Compare two
          </button>
        </div>
        {mode === "one" ? (
          <Drop label="Document" slot={one} onPick={setOne} onError={setError} />
        ) : (
          <div className="pair">
            <Drop label="A" slot={a} examples={singles} onPick={setA} onError={setError} />
            <Drop label="B" slot={b} examples={singles} onPick={setB} onError={setError} />
          </div>
        )}
        <div className="field">
          <label htmlFor="focus">What should the model cover? (optional)</label>
          <textarea
            id="focus"
            value={focus}
            maxLength={600}
            onChange={(e) => setFocus(e.target.value)}
            placeholder={mode === "one" ? "For example: revenue and operating income by segment for the last four quarters, with growth rates. Check the outlook statements." : "For example: put the two issues' forecasts side by side and check what each says changed."}
          />
        </div>
        <label className="toggle">
          <input type="checkbox" checked={python} disabled={sandbox === null} onChange={(e) => setPython(e.target.checked)} />
          <span>
            Let the model run Python
            <span className="faint caption" style={{ display: "block" }}>
              {sandbox === null ? "Off: no sandbox on this machine. See the README." : "For recomputing claims and reading values off charts. Sandboxed, no network."}
            </span>
          </span>
        </label>
        <div className="row">
          <button className="btn btn-primary" onClick={start} disabled={busy !== null}>
            <Icon name="play" size={14} />
            {busy === "upload" ? "Starting" : !ready ? (mode === "one" ? "Choose a PDF" : "Choose A and B") : mode === "one" ? "Build the model" : "Compare them"}
          </button>
        </div>
        {error && (
          <div className="error-box small" role="alert">
            {error}
          </div>
        )}
      </section>

      <section className="stack">
        <h3>Or try a real report</h3>
        <div className="examples">
          {[...singles, ...pairs].map((ex) => (
            <button key={ex.id} className={`example${busy === ex.id ? " picked" : ""}`} disabled={busy !== null} onClick={() => go({ example: ex.id, python }, ex.id)}>
              <img src={`/api/examples/${ex.id}`} alt="" />
              <span className="stack" style={{ gap: 4 }}>
                <span className="faint caption">
                  {ex.publisher}
                  {ex.kind === "scanned" ? " · scanned" : ex.b ? " · compare two" : ""}
                </span>
                <strong>{ex.b ? pairTitle(ex.name, ex.b.name) : ex.name}</strong>
                <span className="what">{ex.b ? `A: ${ex.pages}. B: ${ex.b.pages}.` : ex.pages}</span>
                <span className="faint caption">{busy === ex.id ? "Starting…" : ex.licence}</span>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
