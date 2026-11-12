"use client";

// The whole tour as text: every step with its file, lines, narration and the code itself. Reads well with a
// screen reader, and copies as Markdown with links to the exact commit.
import { useEffect, useState } from "react";
import { Rich } from "@/components/rich";
import { onCode, type RepoSummary, type Tour } from "@/lib/schemas";
import { blobUrl, mdLink as link } from "@/lib/ref";
import { Dialog } from "./dialog";
import { copyText } from "@/lib/announce";
import { withModels } from "@/lib/models";

/** The commit a step's file is shown at: a PR tour's changed files at the PR's head, everything else at the read. */
const shaFor = (tour: Tour, s: RepoSummary, file: string) => (tour.pull?.files.some((f) => f.path === file && f.status !== "removed") ? tour.pull.headSha : s.sha);

const fence = (lines: string[], file: string) => {
  const ext = file.split(".").pop() ?? "";
  const tick = lines.some((l) => l.includes("```")) ? "````" : "```";
  return [`${tick}${/^[a-z0-9]+$/i.test(ext) ? ext : ""}`, ...lines, tick];
};

function tourToMarkdown(tour: Tour, s: RepoSummary, files: Record<string, string[]>) {
  const at = tour.pull?.headSha ?? s.sha;
  return [
    `# ${tour.title}`,
    "",
    `> ${tour.question}`,
    "",
    tour.summary,
    "",
    ...tour.steps.flatMap((st, i) => [
      `## ${i + 1}. ${st.title}`,
      "",
      ...(onCode(st) ? [link(`\`${st.file}:${st.startLine}-${st.endLine}\``, blobUrl(s.owner, s.repo, shaFor(tour, s, st.file), st.file, st.startLine, st.endLine)), ""] : []),
      st.narration,
      "",
      ...(files[st.file] ? [...fence(files[st.file].slice(st.startLine - 1, st.endLine), st.file), ""] : []),
    ]),
    `Explained by Codetrail${withModels(tour.calls)} at commit ${at.slice(0, 7)}; every line range was checked against the code.`,
  ].join("\n");
}

export function TranscriptDialog({ tour, summary, onClose }: { tour: Tour; summary: RepoSummary; onClose: () => void }) {
  const [files, setFiles] = useState<Record<string, string[]>>({});
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    for (const path of new Set(tour.steps.filter(onCode).map((s) => s.file))) {
      fetch(`/api/file?owner=${encodeURIComponent(summary.owner)}&repo=${encodeURIComponent(summary.repo)}&sha=${shaFor(tour, summary, path)}&path=${encodeURIComponent(path)}`)
        .then((r) => (r.ok ? r.text() : ""))
        .then((t) => setFiles((f) => ({ ...f, [path]: t.split("\n") })))
        .catch(() => {});
    }
  }, [tour, summary]);
  return (
    <Dialog title="The tour as text" onClose={onClose} wide>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-[20px] font-medium tracking-tight [font-stretch:85%]">
            <Rich text={tour.title} />
          </p>
          <p className="mt-1 text-[14px] text-fg-2">
            <Rich text={tour.summary} />
          </p>
        </div>
        <button
          onClick={() =>
            copyText(tourToMarkdown(tour, summary, files), "Tour copied as Markdown").then((ok) => {
              if (!ok) return;
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
          className="shrink-0 rounded-[8px] border border-line px-2.5 py-1 font-mono text-[11px] text-fg-2 hover:text-fg"
        >
          {copied ? "Copied" : "Copy as Markdown, with the code"}
        </button>
      </div>
      <ol className="mt-5 space-y-6">
        {tour.steps.map((s, i) => (
          <li key={i}>
            <h3 className="font-medium text-fg">
              <span className="font-mono text-trail">{String(i + 1).padStart(2, "0")}</span> <Rich text={s.title} />
            </h3>
            {onCode(s) && (
              <p className="mt-0.5 font-mono text-[12px] text-fg-3">
                {s.file}, lines {s.startLine} to {s.endLine}
              </p>
            )}
            <div className="mt-1.5 text-[14px] leading-relaxed text-fg-2">
              <Rich text={s.narration} blocks />
            </div>
            {files[s.file] && (
              <pre tabIndex={0} className="code-surface mt-2 overflow-x-auto rounded-[10px] bg-code p-3 font-mono text-[12px] leading-5 text-[#cfd0d6]">
                {files[s.file]
                  .slice(s.startLine - 1, s.endLine)
                  .map((l, k) => `${String(s.startLine + k).padStart(4)}  ${l}`)
                  .join("\n")}
              </pre>
            )}
          </li>
        ))}
      </ol>
    </Dialog>
  );
}
