"use client";

import { Fragment } from "react";
import { int, money, secs } from "@/components/format";
import { modelName } from "@/lib/model-name";
import type { Run } from "@/lib/runs";

export function RunLog({ run }: { run: Run }) {
  const t = run.calls.reduce(
    (a, c) => ({ input: a.input + c.usage.input, cached: a.cached + c.usage.cachedInput, output: a.output + c.usage.output, reasoning: a.reasoning + c.usage.reasoning, ms: a.ms + c.ms, cost: c.cost === null || a.cost === null ? null : a.cost + c.cost }),
    { input: 0, cached: 0, output: 0, reasoning: 0, ms: 0, cost: 0 as number | null },
  );
  const provider = run.calls[0]?.provider;
  const tools = run.steps.flatMap((s) => s.calls);
  const count = (name: string) => tools.filter((c) => c.name === name).length;
  return (
    <div className="stack" style={{ gap: 28 }}>
      <dl className="kv">
        <dt>Model</dt>
        <dd>
          {modelName(run.model)} <span className="faint">({run.model})</span>
        </dd>
        <dt>Provider</dt>
        <dd>{provider === "replay" ? "Stored replies (replay mode)" : provider ? "Nebius Token Factory" : "—"}</dd>
        <dt>Task</dt>
        <dd>{run.options.focus}</dd>
        <dt>Python</dt>
        <dd>{run.options.python ? `On (${count("run_python")} runs)` : "Off"}</dd>
        <dt>Tool calls</dt>
        <dd>
          {count("view_page")} page views, {count("write_cells")} cell writes, {count("run_python")} Python runs, {count("submit_claims")} claim reports
        </dd>
        {[{ key: "A", info: run.doc, file: "document.pdf" }, ...(run.docB ? [{ key: "B", info: run.docB, file: "document-b.pdf" }] : [])].map(({ key, info, file }) => (
          <Fragment key={key}>
            <dt>{run.docB ? `Document ${key}` : "Document"}</dt>
            <dd>
              {info.name}, {info.pages} pages
              {info.scanned?.length ? `, ${info.scanned.length} scanned (pages ${info.scanned.join(", ")} read by the model)` : ""}
              {info.unread?.length ? `; not read: ${info.unread.join(", ")}` : ""}{" "}
              <a href={`/api/runs/${run.id}/files/${file}`} download>
                download
              </a>
            </dd>
            {info.source?.url && (
              <>
                <dt>Source{run.docB ? ` of ${key}` : ""}</dt>
                <dd>
                  <a href={info.source.url} target="_blank" rel="noreferrer">
                    {info.source.author ?? info.source.url}
                  </a>
                  {info.source.licence ? `, ${info.source.licence}` : ""}
                  {info.source.note ? `. ${info.source.note}` : ""}
                </dd>
              </>
            )}
          </Fragment>
        ))}
        {run.edits?.length ? (
          <>
            <dt>Hand edits</dt>
            <dd>
              {run.edits.map((e, i) => (
                <div key={i} className="faint">
                  {new Date(e.at).toLocaleString("en-GB")}: {e.kind === "reset" ? "reset" : "edited"} {e.sheet}!{e.ref}
                  {e.kind === "edit" && e.after ? ` to ${e.after.formula ?? e.after.value}` : ""}
                </div>
              ))}
            </dd>
          </>
        ) : null}
      </dl>
      <div className="scroll-x">
        <table className="log">
          <thead>
            <tr>
              <th>Model call</th>
              <th>Time</th>
              <th>Input</th>
              <th>Cached</th>
              <th>Output</th>
              <th>Reasoning</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {run.calls.map((c) => (
              <tr key={`${c.stage ?? "agent"}-${c.doc ?? ""}-${c.page ?? ""}-${c.step}-${c.startedAt}`}>
                <td>
                  {c.stage === "transcribe" ? `Read scanned ${c.doc === "B" ? "B " : run.docB ? "A " : ""}page ${c.page}` : `Step ${c.step}`}
                  {c.error ? <span className="badge fail" style={{ marginLeft: 8 }}>Error</span> : null}
                </td>
                <td>{secs(c.ms)}</td>
                <td>{int(c.usage.input)}</td>
                <td>{int(c.usage.cachedInput)}</td>
                <td>{int(c.usage.output)}</td>
                <td>{int(c.usage.reasoning)}</td>
                <td>{money(c.cost)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>{run.calls.length} calls</td>
              <td>{secs(t.ms)}</td>
              <td>{int(t.input)}</td>
              <td>{int(t.cached)}</td>
              <td>{int(t.output)}</td>
              <td>{int(t.reasoning)}</td>
              <td>{money(t.cost)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="faint caption" style={{ margin: 0 }}>
        Input counts every token sent in that call, so it grows as the conversation does; cached tokens are the part the provider served from its prompt cache. Cost uses INKLING_PRICE_* from your
        environment.
      </p>
      <div className="row">
        <a className="btn" href={`/api/runs/${run.id}`} target="_blank" rel="noreferrer">
          <span>Open run.json</span>
        </a>
      </div>
    </div>
  );
}
