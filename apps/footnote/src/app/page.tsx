import { pairTitle } from "@/lib/doc-names";
import { modelName } from "@/lib/model-name";
import Link from "next/link";
import { Start } from "@/components/Start";
import { listExamples } from "@/lib/examples";
import { pythonAvailable } from "@/lib/python";
import { listRuns, type Run } from "@/lib/runs";
import { openDb, totals } from "@/lib/db";
import { SearchRuns } from "@/components/SearchRuns";

export const dynamic = "force-dynamic";

function runStatus(r: Run) {
  if (r.status === "failed") return <span className="badge fail">Failed</span>;
  if (r.status !== "done") return <span className="badge info">Running</span>;
  const s = r.result?.summary;
  if (!s) return <span className="badge info">Done</span>;
  return (
    <span className={`badge ${s.failures ? "warn" : "ok"}`}>
      {s.matched + (s.matchedScan ?? 0)} of {s.inputs} matched{s.failures ? `, ${s.failures} to review` : ""}
    </span>
  );
}

// "8 runs, $0.64 in Inkling calls": every run on this machine and what it cost at your prices.
function spendLine(t: ReturnType<typeof totals>) {
  const cost = t.cost < 0.01 && t.cost > 0 ? `$${t.cost.toFixed(4)}` : `$${t.cost.toFixed(2)}`;
  const unknown = t.costUnknown ? ` (${t.costUnknown} without a price set)` : "";
  return `${t.runs} ${t.runs === 1 ? "run" : "runs"}, ${cost} in Inkling calls${unknown}.`;
}

export default async function Home() {
  const [examples, runs, sandbox] = await Promise.all([listExamples(), listRuns(), pythonAvailable()]);
  return (
    <>
      <section className="hero">
        <h1>Turn a report into a spreadsheet you can check</h1>
        <p>
          Upload a report PDF. Inkling 2 Small reads the pages and builds a spreadsheet model with live formulas, citing the page and line behind every number, then checks the
          report&apos;s own claims with Python. Footnote checks the model in turn: each number against the page text, each formula recomputed.
        </p>
      </section>
      <hr className="gradient-rule" />
      <div style={{ padding: "40px 0 64px" }} className="stack">
        <Start examples={examples} sandbox={sandbox} />

        <section className="facts" style={{ marginTop: 24 }} aria-label="How it works">
          <div className="fact">
            <span className="k">Reads pages and charts</span>
            <p>Inkling opens each page as an image and as its exact text, zooms into charts, and writes formulas instead of pasting numbers.</p>
          </div>
          <div className="fact">
            <span className="k">Cites every number</span>
            <p>Every input cell cites a page and a quote. Click a cell to see the line it came from, highlighted on the page.</p>
          </div>
          <div className="fact">
            <span className="k">Verified in code</span>
            <p>Footnote finds each number in the page text, recomputes every formula, adds up totals and flags anything without a source.</p>
          </div>
        </section>

        {runs.length > 0 && <SearchRuns />}

        {runs.length > 0 && (
          <section className="stack" style={{ marginTop: 24 }}>
            <h3>Recent runs</h3>
            <div className="runs">
              {runs.slice(0, 20).map((r) => (
                <Link key={r.id} href={`/run/${r.id}`} className="run-row">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.docB ? pairTitle(r.doc.name, r.docB.name) : r.doc.name}</div>
                    <div className="faint caption">
                      {new Date(r.createdAt).toLocaleString("en-GB")} · {r.docB ? `${r.doc.pages || "?"} + ${r.docB.pages || "?"}` : r.doc.pages || "?"} pages{r.doc.scanned?.length ? ` (${r.doc.scanned.length} scanned)` : ""} · {modelName(r.model)} · Python {r.options.python ? "on" : "off"}
                    </div>
                  </div>
                  {runStatus(r)}
                </Link>
              ))}
            </div>
            <p className="faint small spend">{spendLine(totals(openDb().db))}</p>
          </section>
        )}
      </div>
    </>
  );
}
