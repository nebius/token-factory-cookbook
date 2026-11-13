"use client";

import { Icon, type IconName } from "@/components/Icon";
import { fmtValue, secs } from "@/components/format";
import type { CallLog } from "@/lib/model/client";
import type { Step, TraceCall } from "@/lib/runs";

const TOOL_ICON: Record<string, IconName> = { list_pages: "list", search_pages: "list", view_page: "eye", run_python: "code", write_cells: "layers", submit_claims: "ok" };

type CellArg = { ref: string; label?: string | null; value?: number | string | null; formula?: string | null; format?: string | null; source?: { page: number; quote?: string | null; box?: number[] | null } | null };

function CellsTable({ sheet, cells }: { sheet: string; cells: CellArg[] }) {
  return (
    <div className="scroll-x">
      <table className="mini">
        <thead>
          <tr>
            <th>{sheet}</th>
            <th>Label</th>
            <th style={{ textAlign: "right" }}>Value</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {cells.map((c, i) => (
            <tr key={i}>
              <td>{c.ref}</td>
              <td>{c.label ?? ""}</td>
              <td className="num">{c.formula ?? fmtValue(c.value ?? undefined, (c.format as never) ?? undefined)}</td>
              <td className="faint">{c.source ? `p${c.source.page}${c.source.quote ? `: “${c.source.quote}”` : c.source.box ? ", chart region" : ""}` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Call({ runId, call }: { runId: string; call: TraceCall }) {
  const args = call.args as Record<string, unknown>;
  return (
    <div className="tcall">
      <div className="tcall-head">
        <Icon name={TOOL_ICON[call.name] ?? "cpu"} size={14} />
        <span className="tool">{call.name}</span>
        <span className="sum">{call.summary}</span>
        {!call.ok && <span className="badge fail">Error</span>}
      </div>
      {call.images && call.images.length > 0 && (
        <div className="thumbs">
          {call.images.map((im) => (
            <a key={im.file} href={`/api/runs/${runId}/files/${im.file}`} target="_blank" rel="noreferrer" title={`Page ${im.page}${im.crop ? " (zoomed)" : ""}: what the model saw`}>
              <img src={`/api/runs/${runId}/files/${im.file}`} alt={`Page ${im.page}${im.crop ? " crop" : ""} as sent to the model`} loading="lazy" />
            </a>
          ))}
        </div>
      )}
      {call.python && (
        <>
          <pre className="code">{call.python.code}</pre>
          <pre className="code wrap" style={{ color: call.ok ? "var(--text-2)" : "var(--bad)" }}>
            {(call.python.stdout || "(no output)") + (call.python.stderr ? `\n${call.python.stderr}` : "")}
            {`\n— ${secs(call.python.ms)}`}
          </pre>
        </>
      )}
      {call.name === "write_cells" && Array.isArray(args?.cells) && (
        <details>
          <summary>{(args.cells as unknown[]).length} cells written</summary>
          <div style={{ marginTop: 8 }}>
            <CellsTable sheet={String(args.sheet ?? "")} cells={args.cells as CellArg[]} />
          </div>
        </details>
      )}
      {call.name === "write_cells" && call.output && (
        <details>
          <summary>What Footnote told the model</summary>
          <pre className="code wrap" style={{ marginTop: 8 }}>
            {call.output}
          </pre>
        </details>
      )}
      {call.name === "view_page" && call.output && (
        <details>
          <summary>Text layer sent with the image</summary>
          <pre className="code wrap" style={{ marginTop: 8 }}>
            {call.output}
          </pre>
        </details>
      )}
      {!call.ok && !call.python && (
        <pre className="code wrap" style={{ color: "var(--bad)" }}>
          {call.summary}
        </pre>
      )}
    </div>
  );
}

// Several pages viewed in one step read better as one row of thumbnails than as a card per page.
function group(calls: TraceCall[]): (TraceCall | TraceCall[])[] {
  const out: (TraceCall | TraceCall[])[] = [];
  for (const c of calls) {
    const last = out[out.length - 1];
    if (c.name === "view_page" && c.ok && Array.isArray(last)) last.push(c);
    else if (c.name === "view_page" && c.ok) out.push([c]);
    else out.push(c);
  }
  return out.map((g) => (Array.isArray(g) && g.length === 1 ? g[0] : g));
}

function Views({ runId, calls }: { runId: string; calls: TraceCall[] }) {
  const label = (c: TraceCall) => c.summary.replace(/^Page /, "");
  return (
    <div className="tcall">
      <div className="tcall-head">
        <Icon name="eye" size={14} />
        <span className="tool">view_page × {calls.length}</span>
        <span className="sum">Pages {calls.map(label).join(", ")}</span>
      </div>
      <div className="thumbs">
        {calls.flatMap((c) =>
          (c.images ?? []).map((im) => (
            <a key={im.file} href={`/api/runs/${runId}/files/${im.file}`} target="_blank" rel="noreferrer" title={`Page ${im.page}${im.crop ? " (zoomed)" : ""}: what the model saw`}>
              <img src={`/api/runs/${runId}/files/${im.file}`} alt={`Page ${im.page}${im.crop ? " crop" : ""} as sent to the model`} loading="lazy" />
              <span className="faint caption">
                {im.doc ? `${im.doc} ` : ""}p{im.page}
                {im.crop ? " zoom" : ""}
              </span>
            </a>
          )),
        )}
      </div>
      <details>
        <summary>Text layers sent with the images</summary>
        {calls.map((c) => (
          <pre key={c.id} className="code wrap" style={{ marginTop: 8 }}>
            {`${c.summary}\n${c.output ?? ""}`}
          </pre>
        ))}
      </details>
    </div>
  );
}

// The pages the model transcribed before the agent loop, as one block at the top of the trace.
function Transcription({ runId, calls, docs }: { runId: string; calls: CallLog[]; docs: { key: "A" | "B"; name: string }[] }) {
  const t = calls.filter((c) => c.stage === "transcribe").sort((a, b) => (a.doc ?? "A").localeCompare(b.doc ?? "A") || (a.page ?? 0) - (b.page ?? 0));
  if (!t.length) return null;
  const two = docs.length > 1;
  const ms = t.reduce((n, c) => n + c.ms, 0);
  const failed = t.filter((c) => c.error);
  return (
    <div className="tstep">
      <div className="num">
        <b>Before</b>
        {secs(ms)} of model time, 4 pages at a time
      </div>
      <div style={{ minWidth: 0 }}>
        <p className="say">
          The model read {t.length - failed.length} scanned {t.length - failed.length === 1 ? "page" : "pages"} from the image, one call per page, and its transcription became {t.length === 1 ? "that page's" : "those pages'"} text layer.
          {failed.length ? ` ${failed.length} could not be read: ${failed.map((c) => `${two ? `${c.doc} ` : ""}p${c.page}`).join(", ")}.` : ""}
        </p>
        <div className="thumbs">
          {t.map((c) => (
            <a key={`${c.doc}-${c.page}`} href={`/api/runs/${runId}/pages/${c.page}${c.doc === "B" ? "?doc=B" : ""}`} target="_blank" rel="noreferrer" title={`${c.error ? "Not read: " + c.error : `${c.usage.output.toLocaleString("en-US")} output tokens`}`}>
              <img src={`/api/runs/${runId}/pages/${c.page}${c.doc === "B" ? "?doc=B" : ""}`} alt={`Scanned page ${c.page}`} loading="lazy" />
              <span className="faint caption">
                {two ? `${c.doc} ` : ""}p{c.page}
                {c.error ? " (not read)" : ""}
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Trace({ runId, steps, calls, docs = [] }: { runId: string; steps: Step[]; calls: CallLog[]; docs?: { key: "A" | "B"; name: string }[] }) {
  const pre = <Transcription runId={runId} calls={calls} docs={docs} />;
  if (!steps.length)
    return (
      <div className="trace">
        {pre}
        <p className="muted">The model&apos;s steps appear here as it works.</p>
      </div>
    );
  return (
    <div className="trace">
      {pre}
      {steps.map((s) => {
        const log = calls.find((c) => c.step === s.n && c.stage !== "transcribe");
        return (
          <div key={s.n} className="tstep">
            <div className="num">
              <b>Step {s.n}</b>
              {log && secs(log.ms)}
            </div>
            <div style={{ minWidth: 0 }}>
              {s.cutOff && (
                <p className="say" style={{ marginBottom: 6 }}>
                  <span className="badge warn">Cut off</span> <span className="faint">This reply hit the output token limit; Footnote dropped it and asked the model to continue more briefly.</span>
                </p>
              )}
              {s.text && <p className="say">{s.text}</p>}
              {s.reasoning && (
                <details>
                  <summary>Reasoning ({s.reasoning.length.toLocaleString("en-US")} characters)</summary>
                  <pre className="code wrap" style={{ marginTop: 8, color: "var(--text-2)" }}>
                    {s.reasoning}
                  </pre>
                </details>
              )}
              {group(s.calls).map((g) => (Array.isArray(g) ? <Views key={g[0].id} runId={runId} calls={g} /> : <Call key={g.id} runId={runId} call={g} />))}
              {!s.text && !s.calls.length && <p className="faint small">No tool call in this step.</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
