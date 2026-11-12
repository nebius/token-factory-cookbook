"use client";

import { ArrowLeft, ArrowUpRight, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Viewer3D } from "@/components/viewer/Viewer3D";
import { api } from "@/lib/client/api";
import type { JobView, StageId } from "@/lib/jobs/runner";
import type { Meta } from "@/lib/schema/teardown";
import styles from "./gen.module.css";

const LABELS: Record<StageId, string> = {
  identify: "Looking at your machine",
  design: "Designing every part",
  build: "Building the 3D model",
  diagrams: "Drawing the diagrams",
  review: "Checking its own work",
  save: "Saving it",
};

/** Turn a technical failure into words anyone can act on. */
function explain(message: string): { title: string; text: string; fix?: string; link?: string } {
  if (/No API key/i.test(message)) return { title: "Kimi isn't set up yet", text: "The app needs a Nebius API key to talk to Kimi.", fix: "Add NEBIUS_API_KEY to cutaway/.env and restart the app." };
  if (/401|403|invalid.*key|unauthori[sz]ed|authentication/i.test(message)) {
    return { title: "Nebius didn't accept the key", text: "The Nebius API key is wrong, expired or has no access to Kimi K3.1 Pro.", fix: "Check NEBIUS_API_KEY in cutaway/.env, then restart the app." };
  }
  if (/402|credit|insufficient|balance/i.test(message)) return { title: "Out of credit", text: "The Nebius account has run out of credit.", fix: "Top up on Nebius Token Factory, then try again." };
  if (/404|model.*not.*found|does not exist/i.test(message)) return { title: "Model not found", text: "Nebius doesn't recognise the model name.", fix: "Remove KIMI_MODEL from cutaway/.env to use moonshotai/Kimi-K3.1-Pro, then restart the app." };
  if (/429|rate limit/i.test(message)) return { title: "Kimi is busy", text: "Too many requests at once.", fix: "Wait a minute, then try again." };
  if (/^Stopped/i.test(message)) return { title: "Stopped", text: "You stopped this one. Everything finished so far is saved." };
  if (/couldn't find a machine/i.test(message)) return { title: "No machine found", text: message };
  return { title: "Something went wrong", text: "Kimi hit a problem. Everything finished so far is saved, so trying again picks up from there." };
}

type Poll = { job: JobView; status: string; pv: string; hasPhoto: boolean; inputKind?: string; meta?: Meta | null; parts?: { id: string; code: string }[] };

export function GenerationView({ id }: { id: number }) {
  const router = useRouter();
  const [job, setJob] = useState<JobView | null>(null);
  const [status, setStatus] = useState<string>("");
  const [hasPhoto, setHasPhoto] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [parts, setParts] = useState<{ id: string; code: string }[]>([]);
  const [answer, setAnswer] = useState("");
  const [missing, setMissing] = useState(false);
  const pv = useRef("");
  const resumed = useRef(false);

  // The run lives on the server; this page only watches it. Leaving never stops anything.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await api<Poll>(`/api/jobs/${id}?pv=${encodeURIComponent(pv.current)}`);
        if (!alive) return;
        setJob(r.job);
        setStatus(r.status);
        setHasPhoto(r.hasPhoto);
        if (r.parts) {
          pv.current = r.pv;
          if (r.meta) setMeta(r.meta);
          setParts(r.parts);
        }
        if (r.job.done) {
          router.replace(r.job.done.existing ? `/t/${r.job.done.slug}` : `/t/${r.job.done.slug}?v=${r.job.done.version}`);
          return;
        }
        // A server restart drops the in-memory job; carry on from the last saved step.
        if (!r.job.running && !r.job.error && !resumed.current && r.status !== "ready" && r.status !== "failed") {
          resumed.current = true;
          void api(`/api/jobs/${id}`, { method: "POST" });
        }
      } catch (e) {
        if (e instanceof Error && /not found/i.test(e.message)) {
          setMissing(true);
          return;
        }
      }
      timer = setTimeout(tick, document.hidden ? 4000 : 1000);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id, router]);

  const retry = async () => {
    resumed.current = true;
    const r = await api<{ job: JobView }>(`/api/jobs/${id}`, { method: "POST" });
    setJob(r.job);
  };
  const stop = () => void api(`/api/jobs/${id}`, { method: "DELETE" });
  const respond = (value: string | boolean | null) => void api(`/api/jobs/${id}/answer`, { body: { value } });

  if (missing) {
    return (
      <div className={styles.center}>
        <h1 className={styles.bigTitle}>This one isn&apos;t here anymore.</h1>
        <Link href="/" className="btn">
          Back home
        </Link>
      </div>
    );
  }

  const why = job?.error ? explain(job.error) : null;
  const pct = Math.round((job?.progress ?? 0) * 100);
  const name = meta?.device.name ?? job?.name ?? "Your machine";

  return (
    <div className={styles.app}>
      <header className={styles.top}>
        <Link href="/" className={styles.back}>
          <ArrowLeft size={16} /> Home
        </Link>
        <span className={styles.topNote}>{job?.running ? "You can leave this page. Kimi keeps building and we'll let you know when it's ready." : ""}</span>
        {job?.running && (
          <button className="btn btn-sm" onClick={stop}>
            Stop
          </button>
        )}
      </header>

      <div className={styles.body}>
        <aside className={`${styles.side} scroll`}>
          <div className={styles.eyebrow}>{why ? "Paused" : status === "ready" ? "Ready" : "Kimi K3.1 Pro is building"}</div>
          <h1 className={styles.title}>{name}</h1>
          {hasPhoto && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className={styles.photo} src={`/api/input/${id}`} alt="Your photo" />
          )}

          <div className={styles.meter} aria-label={`${pct}% done`}>
            <span style={{ width: `${Math.max(pct, 3)}%` }} />
          </div>
          <div className={styles.meterText}>
            <span>{pct}%</span>
            <span>{job?.preview ? "Parts ready · finishing the extras" : "Usually 20 to 40 minutes"}</span>
          </div>

          {job?.preview && !job.done && (
            <Link href={`/t/${job.preview.slug}?v=${job.preview.version}`} className={`btn btn-primary ${styles.early}`}>
              Start exploring now <ArrowUpRight size={16} />
            </Link>
          )}

          <ol className={styles.steps}>
            {(job?.stages ?? []).map((s, i) => (
              <li key={s.id} data-state={s.state}>
                <span className={styles.num}>{s.state === "done" ? "✓" : String(i + 1).padStart(2, "0")}</span>
                <div>
                  <div className={styles.stepLabel}>{LABELS[s.id]}</div>
                  {s.detail && <div className={styles.stepDetail}>{s.detail}</div>}
                </div>
              </li>
            ))}
          </ol>

          {job?.waiting?.kind === "question" && (
            <section className={styles.ask}>
              <div className={styles.eyebrow}>Kimi has a question</div>
              <p className={styles.askText}>{job.waiting.question.text}</p>
              <div className={styles.options}>
                {job.waiting.question.options.map((o) => (
                  <button key={o} className="btn btn-sm" onClick={() => respond(o)}>
                    {o}
                  </button>
                ))}
              </div>
              <div className={styles.answerRow}>
                <input className="input" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Or type an answer" />
                <button className="btn btn-sm" onClick={() => respond(answer.trim() || null)}>
                  {answer.trim() ? "Send" : "Skip"}
                </button>
              </div>
            </section>
          )}

          {job?.waiting?.kind === "existing" && (
            <section className={styles.ask}>
              <div className={styles.eyebrow}>Already in your machines</div>
              <p className={styles.askText}>You already have “{job.waiting.name}”. Open it now, or have Kimi design a fresh version from this photo.</p>
              <div className={styles.options}>
                <button className="btn btn-primary btn-sm" onClick={() => respond(true)}>
                  Open it
                </button>
                <button className="btn btn-sm" onClick={() => respond(false)}>
                  Make a new version
                </button>
              </div>
            </section>
          )}

          {why && job?.error && (
            <section className={styles.error}>
              <div className={styles.errorTitle}>{why.title}</div>
              <p>{why.text}</p>
              {why.fix && <p className={styles.fix}>{why.fix}</p>}
              <div className={styles.options}>
                <button className="btn btn-primary btn-sm" onClick={retry}>
                  <RefreshCw size={14} /> Try again
                </button>
                {why.link && (
                  <a className="btn btn-sm" href={why.link} target="_blank" rel="noreferrer">
                    Open settings <ArrowUpRight size={14} />
                  </a>
                )}
              </div>
              <details className={styles.details}>
                <summary>Technical details</summary>
                <code>{job.error}</code>
              </details>
            </section>
          )}

          {!!job?.log.length && (
            <details className={styles.details}>
              <summary>What Kimi did</summary>
              <ul className={styles.log}>
                {job.log.map((l) => (
                  <li key={l.t + l.text} data-tone={l.tone}>
                    {l.text}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {!!job?.calls && <div className={styles.calls}>{job.calls} model call{job.calls === 1 ? "" : "s"} so far</div>}
        </aside>

        <section className={`${styles.stage} stage-surface`}>
          {meta && parts.length > 0 ? (
            <Viewer3D meta={meta} parts={parts} initialExplode={0.25} initialLabels="off" toolbar={false} keyboard />
          ) : (
            <div className={styles.waiting}>
              <div className={styles.orbit} aria-hidden="true">
                <span />
              </div>
              <p className={styles.waitText}>{why ? "Waiting for you." : "The parts appear here as Kimi designs them."}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
