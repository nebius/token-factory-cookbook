import { checkMeta } from "@/lib/check/meta";
import { deleteTeardown, getDiagrams, getParts, getTeardown, setPartResults, updateTeardown } from "@/lib/db/teardowns";
import { KimiError } from "@/lib/kimi/client";
import { design, diagrams, finalize, identify, MAX_REVIEW_ROUNDS, review, type DesignEvent } from "@/lib/kimi/pipeline";
import { rasterViews } from "@/lib/render/raster";
import { buildOnServer } from "@/lib/sandbox/server";
import { THUMBNAIL, THUMBNAIL_SIZE } from "@/lib/viewer/frame";
import type { BuiltPart, Issue } from "@/lib/sandbox/types";
import type { Identity, Meta } from "@/lib/schema/teardown";

/**
 * Generation runs on the server, not in the page. Closing the tab, switching pages or opening another
 * machine doesn't stop it; pages only watch. State lives in memory while the job runs and everything it
 * produces is saved to SQLite as it goes, so a restarted server resumes from the last finished step.
 */

export type StageId = "identify" | "design" | "build" | "diagrams" | "review" | "save";
export type StageState = "todo" | "run" | "done" | "error";
export type Waiting = { kind: "question"; question: NonNullable<Identity["question"]> } | { kind: "existing"; slug: string; name: string };

export type JobView = {
  id: number;
  name: string | null;
  running: boolean;
  stages: { id: StageId; state: StageState; detail: string | null }[];
  log: { t: number; text: string; tone?: "ok" | "warn" | "err" }[];
  calls: number;
  waiting: Waiting | null;
  error: string | null;
  done: { slug: string; version: number; existing?: boolean } | null;
  /** Set once every part is built: the machine can be explored while diagrams and the self-review finish. */
  preview: { slug: string; version: number } | null;
  startedAt: number | null;
  progress: number;
};

const ORDER: StageId[] = ["identify", "design", "build", "diagrams", "review", "save"];

class Job {
  readonly id: number;
  name: string | null = null;
  running = false;
  stages = new Map<StageId, { state: StageState; detail: string | null }>(ORDER.map((s) => [s, { state: "todo", detail: null }]));
  log: JobView["log"] = [];
  calls = 0;
  waiting: Waiting | null = null;
  error: string | null = null;
  done: JobView["done"] = null;
  preview: JobView["preview"] = null;
  startedAt: number | null = null;
  private abort = new AbortController();
  private answer: ((v: string | boolean | null) => void) | null = null;
  private built = new Map<string, BuiltPart>();

  constructor(id: number) {
    this.id = id;
  }

  view(): JobView {
    const stages = ORDER.map((id) => ({ id, ...this.stages.get(id)! }));
    const done = stages.filter((s) => s.state === "done").length;
    const running = stages.find((s) => s.state === "run");
    return {
      id: this.id,
      name: this.name,
      running: this.running,
      stages,
      log: this.log.slice(-40),
      calls: this.calls,
      waiting: this.waiting,
      error: this.error,
      done: this.done,
      preview: this.done ? null : this.preview,
      startedAt: this.startedAt,
      progress: Math.min(1, (done + (running ? 0.5 : 0)) / ORDER.length),
    };
  }

  private stage(id: StageId, state: StageState, detail?: string | null) {
    const s = this.stages.get(id)!;
    s.state = state;
    if (detail !== undefined) s.detail = detail;
  }
  private note(text: string, tone?: "ok" | "warn" | "err") {
    this.log.push({ t: Date.now(), text, tone });
    if (this.log.length > 80) this.log.shift();
  }

  /** Called by a page: an answer to Kimi's question (string or null to skip) or the open-existing choice. */
  respond(v: string | boolean | null) {
    this.answer?.(v);
  }

  cancel() {
    this.abort.abort();
    this.answer?.(null);
  }

  private wait(w: Waiting): Promise<string | boolean | null> {
    this.waiting = w;
    return new Promise((res) => {
      this.answer = (v) => {
        this.answer = null;
        this.waiting = null;
        res(v);
      };
    });
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.error = null;
    this.done = null;
    this.startedAt = Date.now();
    this.abort = new AbortController();
    for (const s of this.stages.values()) if (s.state !== "done") Object.assign(s, { state: "todo", detail: null });
    void this.run()
      .catch((e: unknown) => {
        const message = this.abort.signal.aborted ? "Stopped." : e instanceof Error ? e.message : String(e);
        this.error = message;
        const first = ORDER.find((s) => this.stages.get(s)!.state === "run");
        for (const s of ORDER) {
          const st = this.stages.get(s)!;
          if (st.state === "run") Object.assign(st, s === first ? { state: "error" } : { state: "todo", detail: null });
        }
        this.note(message, "err");
        try {
          updateTeardown(this.id, { status: "failed", error: message });
        } catch {
          /* deleted meanwhile */
        }
      })
      .finally(() => {
        this.running = false;
      });
  }

  private async build(parts: { id: string; code: string }[], size: [number, number, number]) {
    const res = await buildOnServer(parts, size);
    for (const r of res) this.built.set(r.id, r);
    setPartResults(this.id, res.map((r) => ({ id: r.id, ok: r.ok, error: r.issues.find((i) => i.severity === "error")?.message ?? null })));
    return res;
  }

  private issues(meta: Meta): Issue[] {
    const codes = getParts(this.id).map((p) => p.part_id);
    return [...checkMeta(meta, codes), ...[...this.built.values()].flatMap((b) => b.issues)];
  }

  private async run() {
    const signal = this.abort.signal;
    let t = getTeardown(this.id);
    if (!t) throw new KimiError("This machine no longer exists.", "config");
    this.name = t.name;
    if (t.status === "ready") {
      for (const s of ORDER) this.stage(s, "done");
      this.done = { slug: t.slug, version: t.version };
      return;
    }

    // 1. Identify
    if (!t.identity) {
      this.stage("identify", "run", t.input_kind === "image" ? "Kimi is looking at your photo…" : null);
      const r = await identify(this.id);
      if (!r.cached && t.input_kind === "image") this.calls++;
      if (r.identity.confidence === 0 || r.identity.device === "unknown") {
        throw new KimiError("Kimi couldn't find a machine in this photo. Try a clearer photo, or type the name instead.", "invalid_output");
      }
      this.name = r.identity.device;
      this.stage("identify", "done", `${r.identity.device}${t.input_kind === "image" ? ` · ${Math.round(r.identity.confidence * 100)}% sure` : ""}`);
      this.note(`Identified: ${r.identity.device}`, "ok");
      if (r.identity.question && !t.hint) {
        const hint = await this.wait({ kind: "question", question: r.identity.question });
        if (signal.aborted) throw new Error("Stopped.");
        if (typeof hint === "string" && hint.trim()) {
          updateTeardown(this.id, { hint: hint.trim().slice(0, 300) });
          this.note(`You said: ${hint.trim()}`);
        }
      }
      if (r.existing) {
        const open = await this.wait({ kind: "existing", slug: r.existing.slug, name: r.existing.name });
        if (signal.aborted) throw new Error("Stopped.");
        if (open === true) {
          // Nothing new to build: drop the draft and send the watcher to the saved machine.
          deleteTeardown(this.id);
          this.done = { slug: r.existing.slug, version: 0, existing: true };
          for (const s of ORDER) if (this.stages.get(s)!.state !== "done") this.stage(s, "done", s === "save" ? "Opened your saved one" : null);
          return;
        }
      }
      t = getTeardown(this.id)!;
    } else {
      this.stage("identify", "done", t.identity.device);
    }

    // 2. Design (streamed; parts are saved as they arrive)
    let meta = t.meta;
    if (!meta || getParts(this.id).length === 0) {
      this.stage("design", "run", "Kimi is thinking…");
      this.calls++;
      let done: Extract<DesignEvent, { type: "done" }> | null = null;
      let parts = 0;
      await design(
        this.id,
        (e) => {
          if (e.type === "progress") this.stage("design", "run", e.chars ? `Writing the design… ${(e.chars / 1000).toFixed(1)}k characters` : `Thinking… ${(e.reasoningChars / 1000).toFixed(1)}k characters`);
          else if (e.type === "meta") {
            this.name = e.meta.device.name;
            this.note(`Planned ${e.meta.parts.length} parts, ${e.meta.systems.length} flows and ${e.meta.steps.length} steps`, "ok");
          } else if (e.type === "part") this.stage("design", "run", `${++parts} parts designed`);
          else if (e.type === "repair") {
            this.calls++;
            this.note(e.message, "warn");
          } else if (e.type === "done") done = e;
        },
        signal,
      );
      const d = done as Extract<DesignEvent, { type: "done" }> | null;
      t = getTeardown(this.id)!;
      meta = t.meta!;
      this.stage("design", "done", `${meta.parts.length} parts${d?.truncated ? " · the answer was cut short" : ""}`);
      if (d?.truncated) this.note("Kimi's answer hit its length limit; the review round fills in missing parts.", "warn");
    } else {
      this.stage("design", "done", `${meta.parts.length} parts · saved earlier`);
    }
    const size = meta.device.sizeMm;

    // 3. Build every part in the sandbox
    this.stage("build", "run", "Building every part…");
    const all = await this.build(getParts(this.id).map((p) => ({ id: p.part_id, code: p.code })), size);
    const failed = all.filter((r) => !r.ok).length;
    this.stage("build", "done", `${all.length - failed} of ${meta.parts.length} parts built${failed ? ` · ${failed} need fixing` : ""}`);
    const settled = getTeardown(this.id);
    if (settled && !settled.slug.startsWith("draft-")) {
      this.preview = { slug: settled.slug, version: settled.version };
      this.note("Every part is built. You can start exploring while Kimi draws the diagrams and checks its work.", "ok");
    }

    // 4. Drawings, in parallel with the review
    const drawings = (async () => {
      if (getDiagrams(this.id).length >= 3) return this.stage("diagrams", "done", "Saved earlier");
      this.stage("diagrams", "run", "Drawing a cross-section, a flow map and numbered parts…");
      try {
        this.calls++;
        const r = await diagrams(this.id, signal);
        this.stage("diagrams", r.diagrams.length ? "done" : "error", `${r.diagrams.length} of 3 drawings`);
        for (const i of r.issues) this.note(i.message, "warn");
      } catch (e) {
        if (signal.aborted) throw e;
        // Drawings are a bonus; the machine is still saved without them.
        this.stage("diagrams", "error", e instanceof Error ? e.message : String(e));
      }
    })();

    // 5. Kimi checks renders of its own model and fixes what looks wrong
    let current = meta;
    for (let round = (getTeardown(this.id)?.review_rounds ?? 0) + 1; round <= MAX_REVIEW_ROUNDS; round++) {
      const issues = this.issues(current);
      const errors = issues.filter((i) => i.severity === "error");
      if (round > 1 && !errors.length) break;
      this.stage("review", "run", `Round ${round}: showing Kimi four pictures of its model${errors.length ? ` · ${errors.length} problems to fix` : ""}`);
      const shots = rasterViews(current, [...this.built.values()], [{ view: "front" }, { view: "iso" }, { view: "iso", explode: 1 }, { view: "iso", clip: true }]);
      this.calls++;
      const r = await review(this.id, { round, issues, images: { front: shots[0], iso: shots[1], exploded: shots[2], cutaway: shots[3] } }, signal);
      current = r.meta;
      this.note(`Check ${round}: ${r.verdict || "done"}${r.fixes.length ? ` · rewrote ${r.fixes.length} parts` : ""}`, "ok");
      if (!r.fixes.length) break;
      this.stage("review", "run", `Round ${round}: rebuilding ${r.fixes.length} parts…`);
      await this.build(r.fixes, size);
    }
    this.stage("review", "done", `${getTeardown(this.id)?.review_rounds ?? 0} check${(getTeardown(this.id)?.review_rounds ?? 0) === 1 ? "" : "s"}`);

    await drawings;
    if (signal.aborted) throw new Error("Stopped.");

    // 6. Save with a thumbnail rendered on the server
    this.stage("save", "run");
    if (this.built.size === 0) await this.build(getParts(this.id).map((p) => ({ id: p.part_id, code: p.code })), size);
    const [thumb] = rasterViews(current, [...this.built.values()], [THUMBNAIL], THUMBNAIL_SIZE.width, THUMBNAIL_SIZE.height, THUMBNAIL_SIZE.background);
    const saved = finalize(this.id, {
      results: [...this.built.values()].map((r) => ({ id: r.id, ok: r.ok, error: r.issues.find((i) => i.severity === "error")?.message ?? null })),
      thumbnail: thumb,
    });
    this.stage("save", "done");
    this.note("Saved. It's ready to explore!", "ok");
    this.done = { slug: saved.slug, version: saved.version };
  }
}

const g = globalThis as unknown as { __cutawayJobs?: Map<number, Job> };
const jobs = (g.__cutawayJobs ??= new Map());

/** Start (or keep running) the generation for a teardown. Safe to call repeatedly. */
export function startJob(id: number): JobView {
  let job = jobs.get(id);
  if (!job) {
    job = new Job(id);
    jobs.set(id, job);
  }
  job.start();
  return job.view();
}

/** What a page should show. A job this server isn't running (e.g. after a restart) is described from the database. */
export function jobView(id: number): JobView | null {
  const job = jobs.get(id);
  if (job) return job.view();
  const t = getTeardown(id);
  if (!t) return null;
  const j = new Job(id);
  j.name = t.name;
  j.error = t.status === "failed" ? t.error : null;
  if (t.status === "ready") j.done = { slug: t.slug, version: t.version };
  // Not running in this server session: show the steps the database says are already finished.
  const saved = (id: StageId, detail: string) => j.stages.set(id, { state: "done", detail });
  if (t.identity) saved("identify", t.identity.device);
  if (t.meta && getParts(id).length) saved("design", `${t.meta.parts.length} parts · saved`);
  if (getDiagrams(id).length >= 3) saved("diagrams", "3 drawings · saved");
  if (j.error) {
    const next = ORDER.find((s) => j.stages.get(s)!.state !== "done");
    if (next) j.stages.set(next, { state: "error", detail: null });
  }
  return j.view();
}

export function respondJob(id: number, v: string | boolean | null): boolean {
  const job = jobs.get(id);
  if (!job?.waiting) return false;
  job.respond(v);
  return true;
}

export function cancelJob(id: number): void {
  jobs.get(id)?.cancel();
}

/** Jobs started in this server session that are still worth showing (running, waiting, or just finished/failed). */
export function recentJobs(): JobView[] {
  const cutoff = Date.now() - 10 * 60_000;
  return [...jobs.values()].map((j) => j.view()).filter((v) => v.running || v.waiting || (v.startedAt ?? 0) > cutoff);
}
