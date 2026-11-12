import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { formatTokens, formatUsd, timeAgo } from "@/lib/format";
import { LOCAL_OWNER } from "@/lib/ref";
import { parseScope, scopeLabel, scopeQuery } from "@/lib/scope";
import { siteTotals } from "@/server/stats";
import { getRepoSpend } from "@/server/trail/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Data",
  description: "Every repo read on this Codetrail instance: what each one cost, what cached input saved, and the tours stored for free replay.",
  alternates: { canonical: "/data" },
};

export default async function DataPage() {
  const [repos, totals] = await Promise.all([getRepoSpend().catch(() => []), siteTotals().catch(() => null)]);
  const paid = repos.reduce((a, r) => a + r.paid, 0);
  const saved = repos.reduce((a, r) => a + r.saved, 0);
  const input = repos.reduce((a, r) => a + r.input, 0);
  const cached = repos.reduce((a, r) => a + r.cached, 0);
  const tours = repos.reduce((a, r) => a + r.tours, 0);
  // What the same calls would have cost if every token had been billed as fresh input.
  const full = paid + saved;
  const max = Math.max(0.0001, ...repos.flatMap((r) => [r.paid, r.saved]));
  const sorted = [...repos].sort((a, b) => b.paid + b.saved - (a.paid + a.saved));

  return (
    <div className="min-h-dvh bg-ink text-fg">
      <SiteHeader />
      <main id="main" className="mx-auto max-w-[1240px] px-4 pt-10 pb-20 sm:px-6">
        <h1 className="font-display text-[40px] leading-none font-light tracking-[-0.05em] [font-stretch:78%] sm:text-[56px]">
          Repos <span className="font-extrabold text-trail [font-stretch:110%]">read.</span>
        </h1>
        <p className="mt-3 max-w-xl text-[15px] text-fg-2">Every repo read on this Codetrail instance, what it cost, and what cached input saved.</p>

        <section aria-label="Totals" className="mt-10 grid grid-cols-2 border-t border-line lg:grid-cols-5">
          {[
            { v: String(repos.filter((r) => !r.scope).length), l: "repos read whole", c: "" },
            { v: String(tours), l: "tours stored, free to replay", c: "" },
            { v: formatUsd(full), l: "what these calls would have cost without the cache", c: "text-fg-2" },
            { v: formatUsd(paid), l: "spent on model calls", c: "text-trail" },
            { v: formatUsd(saved), l: `saved by cached input: ${full ? Math.round((saved / full) * 100) : 0}% off · ${formatTokens(cached)} of ${formatTokens(input)} input tokens came from the cache`, c: "text-verified" },
          ].map((k) => (
            <div key={k.l} className="border-b border-line py-6 pr-3">
              <div className={`font-display text-[36px] font-medium tracking-tight [font-stretch:80%] ${k.c}`}>{k.v}</div>
              <div className="mt-1 text-[13px] text-fg-3">{k.l}</div>
            </div>
          ))}
        </section>

        <div className="mt-12 flex flex-wrap gap-12">
          <section aria-labelledby="bars" className="min-w-0 flex-[999_1_480px]">
            <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-3">
              <h2 id="bars" className="font-medium">
                Spent and saved, per read
              </h2>
              <span className="flex gap-4 font-mono text-[11px] text-fg-2">
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-[3px] bg-trail" /> spent
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-[3px] bg-verified" /> saved by cached input
                </span>
              </span>
            </div>
            {sorted.length === 0 ? (
              <p className="mt-6 text-sm text-fg-3">
                Nothing read yet. Paste a repo on the{" "}
                <Link href="/" className="text-trail hover:underline">
                  home page
                </Link>{" "}
                to start.
              </p>
            ) : (
              <ul className="mt-5 space-y-5">
                {sorted.map((r) => (
                  <li key={`${r.owner}/${r.repo}@${r.sha}~${r.scope ?? ""}`}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <Link href={`/${r.owner}/${r.repo}${scopeQuery(parseScope(r.scope))}`} className="font-mono text-[13px] hover:text-trail">
                        {r.owner === LOCAL_OWNER ? "this machine" : r.owner}/{r.repo}
                        {r.scope && <span className="ml-2 text-[11px] text-trail">{scopeLabel(parseScope(r.scope))}</span>}
                      </Link>
                      <span className="font-mono text-[11px] text-fg-3">
                        {r.models.join(" + ")} · {formatUsd(r.paid + r.saved)} without the cache
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-[minmax(0,1fr)_76px] items-center gap-x-3 gap-y-1.5">
                      <div className="h-2.5 rounded-r bg-line" aria-hidden title={`Spent ${formatUsd(r.paid)}`}>
                        <div className="h-full rounded-r bg-trail" style={{ width: `${Math.max(0.6, (r.paid / max) * 100)}%` }} />
                      </div>
                      <span className="font-mono text-[12px] text-fg-2">
                        <span className="sr-only">Spent </span>
                        {formatUsd(r.paid)}
                      </span>
                      <div className="h-2.5 rounded-r bg-line" aria-hidden title={`Saved ${formatUsd(r.saved)}`}>
                        <div className="h-full rounded-r bg-verified" style={{ width: `${Math.max(0.6, (r.saved / max) * 100)}%` }} />
                      </div>
                      <span className="font-mono text-[12px] text-fg-2">
                        <span className="sr-only">Saved </span>
                        {formatUsd(r.saved)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="site" className="min-w-0 flex-[1_1_320px] self-start rounded-card border border-line bg-panel p-6">
            <h2 id="site" className="font-display text-[20px] leading-tight font-medium tracking-tight [font-stretch:85%]">
              Model calls across Codetrail
            </h2>
            <dl className="mt-4">
              {[
                ["Repos read", String(totals?.reads ?? 0)],
                ["Tours, answers and docs written", String(totals?.tours ?? 0)],
                ["Tours replayed free", String(totals?.replays ?? 0)],
                ["Tokens read", formatTokens(totals?.inputTokens ?? 0)],
                ["Of those, cached", `${formatTokens(totals?.cachedTokens ?? 0)}`],
                ["Spent", formatUsd(totals?.usd ?? 0)],
                ["Saved by cached input", formatUsd(totals?.savedUsd ?? 0)],
                ["Without the cache, it would have been", formatUsd((totals?.usd ?? 0) + (totals?.savedUsd ?? 0))],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-t border-line py-2.5 text-[14px]">
                  <dt className="text-fg-2">{k}</dt>
                  <dd className="font-mono">{v}</dd>
                </div>
              ))}
            </dl>
            {(totals?.byModel.length ?? 0) > 0 && (
              <>
                <h3 className="mt-5 font-mono text-[11px] tracking-[0.15em] text-fg-3 uppercase">By model</h3>
                <dl className="mt-2">
                  {totals!.byModel.map((m) => (
                    <div key={m.model} className="border-t border-line py-2.5 text-[14px]">
                      <dt className="text-fg">{m.label}</dt>
                      <dd className="mt-0.5 font-mono text-[12px] text-fg-2">
                        {m.calls} {m.calls === 1 ? "call" : "calls"} · {formatUsd(m.usd)} spent · {formatUsd(m.savedUsd)} saved
                      </dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
            <p className="mt-3 text-[12px] text-fg-3">Since stats began on this instance. Prices live from Nebius Token Factory, each call at its own model&apos;s prices.</p>
          </section>
        </div>

        {sorted.length > 0 && (
        <section aria-labelledby="table" className="mt-14">
          <h2 id="table" className="font-medium">
            Repos read
          </h2>
          <div className="relative mt-3 overflow-x-auto">
            <table className="w-full min-w-[1100px] border-collapse text-[14px]">
              <thead>
                <tr className="border-b border-line font-mono text-[11px] tracking-[0.1em] text-fg-3 uppercase">
                  <th scope="col" className="py-2.5 pr-3 text-left font-normal">Repo</th>
                  <th scope="col" className="px-3 text-left font-normal">Model</th>
                  <th scope="col" className="px-3 text-right font-normal">Calls</th>
                  <th scope="col" className="px-3 text-right font-normal">Tokens read</th>
                  <th scope="col" className="px-3 text-left font-normal">From cache</th>
                  <th scope="col" className="px-3 text-right font-normal">Without cache</th>
                  <th scope="col" className="px-3 text-right font-normal">Spent</th>
                  <th scope="col" className="px-3 text-right font-normal">Saved</th>
                  <th scope="col" className="px-3 text-right font-normal">Tours</th>
                  <th scope="col" className="pl-3 text-right font-normal">Last read</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const share = r.input ? Math.round((r.cached / r.input) * 100) : 0;
                  return (
                    <tr key={`${r.owner}/${r.repo}@${r.sha}~${r.scope ?? ""}`} className="border-b border-line">
                      <th scope="row" className="py-3.5 pr-3 text-left font-normal">
                        <Link href={`/${r.owner}/${r.repo}${scopeQuery(parseScope(r.scope))}`} className="font-mono hover:text-trail">
                          {r.owner === LOCAL_OWNER ? "this machine" : r.owner}/{r.repo}
                          {r.scope && <span className="ml-2 text-[11px] text-trail">{scopeLabel(parseScope(r.scope))}</span>}
                        </Link>
                      </th>
                      <td className="px-3 text-[13px] whitespace-nowrap text-fg-2">{r.models.join(" + ") || "—"}</td>
                      <td className="px-3 text-right font-mono text-fg-2">{r.calls}</td>
                      <td className="px-3 text-right font-mono text-fg-2">{formatTokens(r.input)}</td>
                      <td className="px-3">
                        <span className="inline-flex items-center gap-2">
                          <span className="inline-block h-1 w-16 rounded-full bg-line">
                            <span className="block h-full rounded-full bg-trail" style={{ width: `${share}%` }} />
                          </span>
                          <span className="font-mono text-[12px] whitespace-nowrap text-fg-2">
                            {formatTokens(r.cached)} · {share}%
                          </span>
                        </span>
                      </td>
                      <td className="px-3 text-right font-mono text-fg-2">{formatUsd(r.paid + r.saved)}</td>
                      <td className="px-3 text-right font-mono">{formatUsd(r.paid)}</td>
                      <td className="px-3 text-right font-mono text-verified">{r.saved ? formatUsd(r.saved) : "—"}</td>
                      <td className="px-3 text-right font-mono text-fg-2">{r.tours}</td>
                      <td className="pl-3 text-right font-mono text-[12px] text-fg-3">{timeAgo(r.at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        )}
      </main>
    </div>
  );
}
