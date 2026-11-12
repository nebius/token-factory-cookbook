"use client";

// Search and sort the repos read on this instance. Everything is already on the page, so it's instant.
import Link from "next/link";
import { useState } from "react";
import { timeAgo } from "@/lib/format";
import { LOCAL_OWNER } from "@/lib/ref";
import { parseScope, scopeLabel, scopeQuery } from "@/lib/scope";
import type { ReadEntry } from "@/server/trail/service";

const SORTS = { newest: "Newest", stars: "Most stars", name: "Name" } as const;
type Sort = keyof typeof SORTS;

export function BrowseList({ reads }: { reads: ReadEntry[] }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const needle = q.trim().toLowerCase();
  const shown = reads
    .filter((r) => !needle || `${r.owner}/${r.repo} ${r.description ?? ""}`.toLowerCase().includes(needle))
    .sort((a, b) => (sort === "stars" ? b.stars - a.stars : sort === "name" ? `${a.owner}/${a.repo}`.localeCompare(`${b.owner}/${b.repo}`) : b.at - a.at));
  return (
    <section aria-label="Repos" className="mt-8">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="browse-q" className="sr-only">
          Search repos
        </label>
        <input
          id="browse-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or description"
          className="w-full max-w-sm rounded-[10px] border border-line bg-panel px-3 py-2 font-mono text-[13px] text-fg outline-none placeholder:text-fg-3 focus:border-trail/60"
        />
        <div role="radiogroup" aria-label="Sort" className="flex gap-0.5 rounded-[10px] border border-line p-[3px]">
          {(Object.keys(SORTS) as Sort[]).map((s, i, all) => (
            <button
              key={s}
              id={`sort-${s}`}
              role="radio"
              aria-checked={sort === s}
              tabIndex={sort === s ? 0 : -1}
              onClick={() => setSort(s)}
              onKeyDown={(e) => {
                const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
                if (!step) return;
                e.preventDefault();
                const next = all[(i + step + all.length) % all.length];
                setSort(next);
                document.getElementById(`sort-${next}`)?.focus();
              }}
              className={`rounded-[7px] border-b-2 px-2.5 py-1 font-mono text-[11.5px] ${sort === s ? "border-trail bg-fg text-ink" : "border-transparent text-fg-3 hover:text-fg"}`}
            >
              {SORTS[s]}
            </button>
          ))}
        </div>
        <span className="font-mono text-[12px] text-fg-3" aria-live="polite">
          {shown.length} of {reads.length}
        </span>
      </div>
      {reads.length === 0 ? (
        <p className="mt-8 text-sm text-fg-3">
          Nothing read yet. Paste a repo on the{" "}
          <Link href="/" className="text-trail hover:underline">
            home page
          </Link>{" "}
          to start.
        </p>
      ) : shown.length === 0 ? (
        <p className="mt-8 text-sm text-fg-3" role="status">
          No repo matches &ldquo;{q}&rdquo;.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-line border-y border-line">
          {shown.map((r) => (
            <li key={`${r.owner}/${r.repo}~${r.scope ?? ""}`}>
              <Link href={`/${r.owner}/${r.repo}${scopeQuery(parseScope(r.scope))}`} className="group flex flex-wrap items-baseline gap-x-6 gap-y-1 py-4">
                <span className="font-mono text-[15px] group-hover:text-trail">
                  {r.owner === LOCAL_OWNER ? `this machine/${r.repo}` : `${r.owner}/${r.repo}`}
                  {r.scope && <span className="ml-2 text-[12px] text-trail">{scopeLabel(parseScope(r.scope))}</span>}
                </span>
                {r.description && <span className="min-w-0 flex-1 truncate text-[14px] text-fg-2">{r.description}</span>}
                <span className="font-mono text-[12px] text-fg-3">
                  {r.owner === LOCAL_OWNER ? "local folder" : `★ ${r.stars.toLocaleString()}`} · {r.modules} modules · {r.tours} {r.tours === 1 ? "tour" : "tours"}
                  {r.docs ? " · docs" : ""} · {timeAgo(r.at)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
