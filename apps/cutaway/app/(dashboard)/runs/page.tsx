import Link from "next/link";
import styles from "@/components/dashboard/dashboard.module.css";
import { listRuns, runTotals } from "@/lib/db/runs";
import { kimiConfig } from "@/lib/kimi/client";
import { timeAgo } from "@/lib/client/api";

export const metadata = { title: "Run log" };

const fmt = (n: number | null) => (n == null ? "–" : n.toLocaleString());
const money = (n: number | null) => (n == null ? "–" : n === 0 ? "$0.00" : n < 0.01 ? "<$0.01" : `$${n.toFixed(n < 1 ? 3 : 2)}`);
const secs = (ms: number) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s` : `${(ms / 1000).toFixed(1)}s`);

export default function RunsPage() {
  const runs = listRuns();
  const t = runTotals();
  const c = kimiConfig();
  return (
    <div className={styles.page}>
      <div className={styles.intro}>
        <h1>Run log</h1>
        <p>Every call to Kimi K3.1 Pro on Nebius Token Factory: tokens, time and cost. Exploring saved machines, studying and quizzes never call the model, so they never show up here.</p>
      </div>
      <div className={styles.stats}>
        <div className={styles.stat}>
          <b>{t.calls}</b>
          <span>
            calls{t.errors ? ` · ${t.errors} failed` : ""}
          </span>
        </div>
        <div className={styles.stat}>
          <b>{fmt(t.tokens_in)}</b>
          <span>input tokens{t.cached ? ` · ${fmt(t.cached)} cached` : ""}</span>
        </div>
        <div className={styles.stat}>
          <b>{fmt(t.tokens_out)}</b>
          <span>output tokens{t.reasoning ? ` · ${fmt(t.reasoning)} thinking` : ""}</span>
        </div>
        <div className={styles.stat}>
          <b>{money(t.cost_usd)}</b>
          <span>{t.unpriced ? `spent · ${t.unpriced} calls without a price` : `spent · ${secs(t.latency_ms)} of model time`}</span>
        </div>
      </div>
      <p className={styles.note}>
        {c.provider === "replay" ? (
          <>Replay mode: stored answers, no model calls.</>
        ) : (
          <>
            Model <code>{c.model}</code>. Cost uses the price Nebius publishes for this model, applied to the real token counts of each call; cached input is billed at the cached rate.
          </>
        )}
      </p>
      {runs.length ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>When</th>
                <th>Machine</th>
                <th>Step</th>
                <th className={styles.num}>In</th>
                <th className={styles.num}>Cached</th>
                <th className={styles.num}>Out</th>
                <th className={styles.num}>Thinking</th>
                <th className={styles.num}>Cost</th>
                <th className={styles.num}>Time</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className={styles.nowrap}>{timeAgo(r.created_at)}</td>
                  <td>{r.slug && !r.slug.startsWith("draft-") ? <Link href={`/t/${r.slug}`}>{r.device}</Link> : (r.device ?? "–")}</td>
                  <td>
                    <span className={styles.kind}>{r.kind}</span>
                  </td>
                  <td className={styles.num}>{fmt(r.tokens_in)}</td>
                  <td className={styles.num}>{fmt(r.cached_tokens)}</td>
                  <td className={styles.num}>{fmt(r.tokens_out)}</td>
                  <td className={styles.num}>{fmt(r.reasoning_tokens)}</td>
                  <td className={styles.num}>{money(r.cost_usd)}</td>
                  <td className={styles.num}>{secs(r.latency_ms)}</td>
                  <td>
                    <span className={styles.status} data-ok={r.status === "ok"} title={r.error ?? ""}>
                      {r.status === "ok" ? "ok" : "failed"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={styles.empty}>No calls to Kimi on Nebius yet. Start a machine from Home and its calls will show up here.</p>
      )}
    </div>
  );
}
