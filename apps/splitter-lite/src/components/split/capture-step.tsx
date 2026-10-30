"use client";

import { AlertTriangle, ArrowRight, Camera, Check, Files, Hash, ImageUp, Layers, ListPlus, Sparkles } from "lucide-react";
import { site } from "@/config/site";
import * as React from "react";
import { toast } from "sonner";
import { CameraScanner } from "@/components/camera/camera-scanner";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/primitives";
import { compressImage } from "@/lib/image";
import { isPdf, pdfToImages } from "@/lib/pdf";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { ExtractedReceipt, ReceiptIssue } from "@/server/ai/receipt";
import type { UsageReport } from "@/server/ai/pricing";
import type { ToolCall } from "@/server/ai/tools";
import { applyReceipt, draftTotal, usableItems, withBills, type AiCall, type Draft } from "./draft";
import { mergeReceipts } from "./merge-receipts";
import { ModelCard } from "./model-card";

const SCAN_MESSAGES = ["Reasoning about the bill…", "Finding every line…", "Checking tax and fees…", "Adding it all up…"];
/** Most separate bills the app reads for one split. */
const MAX_BILLS = 2;
/** Most pages (photos or PDF pages) for one bill. */
const MAX_PAGES = 4;

export function CaptureStep({
  draft,
  update,
  scanEnabled,
  image,
  setImage,
  onItemized,
  onAmount,
  onContinue,
}: {
  draft: Draft;
  update: (fn: (d: Draft) => Draft) => void;
  scanEnabled: boolean;
  image: string[];
  setImage: (urls: string[]) => void;
  onItemized: () => void;
  onAmount: () => void;
  onContinue: () => void;
}) {
  // Quick split only takes scanned bills (no single amount, no typing), in the bill's own currency.
  const imageOnly = true;
  const lockCurrency = false;
  const [scanning, setScanning] = React.useState(false);
  /** What's being read right now: one entry per bill (pages of one bill share an entry). */
  const [progress, setProgress] = React.useState<{ srcs: string[]; label: string; status: "reading" | "done" | "failed"; detail?: string }[]>([]);
  const abort = React.useRef<AbortController | null>(null);
  const [message, setMessage] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [scanner, setScanner] = React.useState(false);
  const hasDraft = draft.kind === "amount" ? draft.amount > 0 || draft.merchant !== "" : usableItems(draft).length > 0;

  React.useEffect(() => {
    if (!scanning) return;
    const t = setInterval(() => setMessage((m) => (m + 1) % SCAN_MESSAGES.length), 2200);
    return () => clearInterval(t);
  }, [scanning]);

  /** Photos and PDF pages for one bill, resized in the browser (max 4 pages). */
  async function prepare(files: File[]) {
    const sources: Blob[] = [];
    let total = 0;
    for (const f of files.slice(0, MAX_PAGES)) {
      if (isPdf(f)) {
        const pdf = await pdfToImages(f);
        sources.push(...pdf.pages);
        total += pdf.totalPages;
      } else {
        sources.push(f);
        total += 1;
      }
    }
    if (files.length > MAX_PAGES || total > MAX_PAGES) toast.info(`Only the first ${MAX_PAGES} pages are read.`);
    const pages = sources.slice(0, MAX_PAGES);
    const model = await Promise.all(pages.map((b) => compressImage(b)));
    return { model, pages };
  }

  type ExtractBody = { receipt?: ExtractedReceipt; issues?: ReceiptIssue[]; checks?: ToolCall[]; error?: string; code?: string; usage?: UsageReport };
  async function read(blobs: Blob[]): Promise<ExtractBody & { ok: boolean; status: number }> {
    const form = new FormData();
    blobs.forEach((b, i) => form.append("image", b, `page-${i + 1}.jpg`));
    const res = await fetch("/api/extract", { method: "POST", body: form, signal: abort.current?.signal });
    const body = (await res.json().catch(() => ({}))) as ExtractBody;
    return { ...body, ok: res.ok, status: res.status };
  }

  /** The AI calls behind a read, labelled for the usage panel. */
  const readCalls = (bodies: ExtractBody[], label: (i: number) => string): AiCall[] =>
    bodies.flatMap((b, i) => (b.usage ? [{ ...b.usage, label: label(i) }] : []));

  async function run(work: () => Promise<void>) {
    setScanning(true);
    setMessage(0);
    abort.current = new AbortController();
    try {
      await work();
    } catch (e) {
      setImage([]);
      if (e instanceof DOMException && e.name === "AbortError") return;
      toast.error(
        e instanceof Error ? e.message : "Could not read the bill",
        imageOnly ? undefined : { action: { label: "Type it in", onClick: onItemized } },
      );
    } finally {
      setScanning(false);
    }
  }

  /** One bill: a single photo, several photos (pages), or a PDF (first pages rendered in the browser). */
  const scan = (files: File[]) =>
    run(async () => {
      const { model, pages } = await prepare(files);
      const srcs = model.map((b) => URL.createObjectURL(b));
      setImage(srcs);
      setProgress([{ srcs, label: pages.length > 1 ? `1 bill · ${pages.length} pages` : "Bill 1", status: "reading" }]);
      const body = await read(model);
      if (body.code === "multiple_bills") {
        // The AI saw separate bills: ask whether they belong to the same occasion instead of failing.
        setImage([]);
        setUnrelated(files);
        return;
      }
      if (!body.ok || !body.receipt) throw new Error(body.error ?? `Could not read the bill (error ${body.status})`);
      update((d) => ({
        ...applyReceipt(d, body.receipt!, body.issues ?? [], { lockCurrency }),
        checks: body.checks ?? [],
        aiCalls: readCalls([body], () => (pages.length > 1 ? `Read the bill (${pages.length} pages)` : "Read the bill")),
        aiSplit: undefined,
      }));
      toast.success(`Found ${body.receipt.items.length} lines`, { description: "Check them over before splitting." });
      onItemized();
    });

  /** Same occasion, separate bills: read each one, then combine them into one expense. */
  const combine = (all: File[]) =>
    run(async () => {
      const files = all.slice(0, MAX_BILLS);
      if (all.length > MAX_BILLS) toast.info(`Up to ${MAX_BILLS} separate bills at a time: using the first ${MAX_BILLS}.`);
      const prepared = await Promise.all(files.map((f) => prepare([f])));
      const srcs = prepared.map((p) => p.model.map((b) => URL.createObjectURL(b)));
      setImage(srcs.flat());
      setProgress(srcs.map((s, i) => ({ srcs: s, label: `Bill ${i + 1}`, status: "reading" })));
      // Each bill is its own AI call, in parallel; its card updates as soon as it's read.
      const bodies = await Promise.all(
        prepared.map(async (p, i) => {
          const body = await read(p.model);
          setProgress((list) =>
            list.map((x, j) =>
              j === i
                ? body.ok && body.receipt
                  ? { ...x, status: "done", label: body.receipt.merchant?.trim() || x.label, detail: `${body.receipt.items.length} lines` }
                  : { ...x, status: "failed", detail: body.error ?? "Couldn't read" }
                : x,
            ),
          );
          return body;
        }),
      );
      const failed = bodies.find((b) => !b.ok || !b.receipt);
      if (failed) throw new Error(failed.error ?? "One of the bills couldn't be read");
      const merged = mergeReceipts(bodies.map((b) => ({ receipt: b.receipt!, issues: b.issues ?? [] })));
      if ("error" in merged) throw new Error(merged.error);
      update((d) => ({
        ...withBills(applyReceipt(d, merged.receipt, merged.issues, { lockCurrency }), bodies.map((b) => b.receipt!)),
        // Number each bill's arithmetic check by its place in the combined split.
        checks: bodies.flatMap((b, i) => (b.checks ?? []).map((c) => ({ ...c, args: { bill: i + 1 }, result: { ...(c.result as object), bill: i + 1 } }))),
        aiCalls: readCalls(bodies, (i) => `Read bill ${i + 1}${bodies[i].receipt?.merchant ? ` (${bodies[i].receipt!.merchant})` : ""}`),
        aiSplit: undefined,
      }));
      toast.success(`Combined ${files.length} bills · ${merged.receipt.items.length} lines`, { description: "Each line is labelled with its bill." });
      onItemized();
    });

  // Several files picked at once could be pages of one bill or separate bills: ask instead of guessing.
  const [choice, setChoice] = React.useState<File[] | null>(null);
  const [unrelated, setUnrelated] = React.useState<File[] | null>(null);
  const onFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files].slice(0, MAX_PAGES);
    if (files.length > MAX_PAGES) toast.info(`Up to ${MAX_PAGES} files at a time: using the first ${MAX_PAGES}.`);
    if (fileInput.current) fileInput.current.value = "";
    if (list.length > 1) setChoice(list);
    else void scan(list);
  };

  if (unrelated) {
    const n = unrelated.length;
    return (
      <div className="mx-auto grid max-w-md gap-6 py-4">
        <div>
          <h1 className="text-3xl leading-tight sm:text-4xl">These look like {n} different bills</h1>
          <p className="mt-3 text-muted-foreground">
            Are they for the same occasion, like dinner and the taxi home? The AI can read each one and combine them into one split, with every line
            labelled by its bill.
          </p>
        </div>
        <div className="grid gap-3">
          <Button
            size="lg"
            onClick={() => {
              setUnrelated(null);
              void combine(unrelated);
            }}
          >
            <Files /> Yes, combine into one expense
          </Button>
          <Button variant="link" onClick={() => setUnrelated(null)}>
            Start over
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">Each bill is read by its own AI call; the usage panel shows the cost of each.</p>
      </div>
    );
  }

  if (choice) {
    const n = choice.length;
    return (
      <div className="mx-auto grid max-w-md gap-6 py-4">
        <div>
          <h1 className="text-3xl leading-tight sm:text-4xl">You picked {n} files</h1>
          <p className="mt-3 text-muted-foreground">Are they pages of one long bill, or {n} different bills?</p>
        </div>
        <div className="grid gap-3">
          <Button
            size="lg"
            onClick={() => {
              setChoice(null);
              void scan(choice);
            }}
          >
            <Files /> Pages of one bill
          </Button>
          {n <= MAX_BILLS ? (
            <Button
              size="lg"
              variant="outline"
              onClick={() => {
                setChoice(null);
                void combine(choice);
              }}
            >
              <Layers /> {n} bills, same occasion: combine into one split
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">Separate bills: up to {MAX_BILLS} at a time.</p>
          )}
          <Button variant="link" onClick={() => setChoice(null)}>
            Cancel
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Combined bills keep every line, labelled by its bill. For groups and running balances across many bills, use the{" "}
          <a href={site.deployedUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">
            full app
          </a>
          .
        </p>
      </div>
    );
  }

  if (scanning) {
    const many = progress.length > 1 || (progress[0]?.srcs.length ?? 0) > 1;
    const done = progress.filter((p) => p.status !== "reading").length;
    return (
      <div className={cn("mx-auto flex flex-col items-center gap-6 py-4 text-center", many ? "max-w-4xl" : "max-w-sm")}>
        {many ? (
          <ul className={cn("grid w-full gap-4", "grid-cols-1 sm:grid-cols-2")}>
            {progress.map((p, i) => (
              <li key={i} className="grid gap-2 text-left">
                <div className="relative overflow-hidden rounded-lg bg-stone">
                  <div className={cn("grid gap-1", p.srcs.length > 1 && "grid-cols-2")}>
                    {p.srcs.map((src, k) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={k} src={src} alt={`${p.label}, page ${k + 1}`} className={cn("max-h-[52dvh] w-full object-contain transition-opacity", p.status === "reading" ? "opacity-85" : "opacity-60")} />
                    ))}
                  </div>
                  {p.status === "reading" && <div className="animate-scan-line absolute inset-x-0 h-[3px] bg-accent" />}
                  {p.status !== "reading" && (
                    <span
                      className={cn(
                        "absolute right-2 top-2 flex size-8 items-center justify-center rounded-full",
                        p.status === "done" ? "bg-positive text-background" : "bg-warning text-background",
                      )}
                    >
                      {p.status === "done" ? <Check className="size-4" strokeWidth={3} /> : <AlertTriangle className="size-4" />}
                    </span>
                  )}
                </div>
                <div className="px-1">
                  <p className="truncate text-sm font-medium">{p.label}</p>
                  <p className={cn("text-xs", p.status === "failed" ? "text-warning" : "text-muted-foreground")}>
                    {p.status === "reading" ? "Reading with reasoning…" : p.detail}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="relative w-full overflow-hidden rounded-lg bg-stone">
            {image[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image[0]} alt="Your receipt" className="max-h-[55dvh] w-full object-contain opacity-85" />
            ) : (
              <div className="h-80" />
            )}
            <div className="animate-scan-line absolute inset-x-0 h-[3px] bg-accent" />
          </div>
        )}
        <div>
          <p className="flex items-center justify-center gap-2 font-display text-2xl">
            <Sparkles className="size-5 text-accent-ink" /> {progress.length > 1 ? `Reading ${progress.length} bills · ${done} done` : SCAN_MESSAGES[message]}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {progress.length > 1 ? "Each bill is its own AI call, read in parallel with reasoning on." : "Reasoning is on, so this usually takes 10–25 seconds per bill."}
          </p>
        </div>
        <Button variant="outline" onClick={() => abort.current?.abort()}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-8">
      <div className="max-w-2xl">
        <h1 className="text-4xl leading-none sm:text-6xl">What are we splitting?</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Upload one bill, or {MAX_BILLS} from the same night out, like dinner and the taxi home. {site.model} reads every line with reasoning on, then splits it with
          calculator tool calls.
        </p>
      </div>

      {hasDraft && (
        <button
          onClick={onContinue}
          className="flex items-center gap-4 rounded-md border border-hairline p-4 text-left transition hover:border-foreground/40"
        >
          <div className="min-w-0 flex-1">
            <Eyebrow>Draft</Eyebrow>
            <p className="mt-1 truncate">
              {draft.merchant || "Untitled"} · {formatMoney(draftTotal(draft), draft.currency)}
            </p>
          </div>
          <span className="flex items-center gap-1 text-sm underline underline-offset-4">
            Continue <ArrowRight className="size-4" />
          </span>
        </button>
      )}

      <div className={cn("grid gap-4", !imageOnly && "md:grid-cols-2")}>
        {/* Receipt */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (scanEnabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (scanEnabled) onFiles(e.dataTransfer.files);
          }}
          className={cn(
            "flex flex-col gap-6 rounded-lg border border-glass-border bg-stone/70 p-6 shadow-[inset_0_1px_0_var(--glass-shine),0_24px_60px_-24px_rgb(0_0_0/0.35)] backdrop-blur-2xl transition sm:p-8",
            dragging && "outline-2 outline-dashed outline-offset-[-8px] outline-foreground/40",
          )}
        >
          <div className="flex items-center justify-between">
            <span className="flex size-12 items-center justify-center rounded-full border border-glass-border bg-card/70 shadow-[inset_0_1px_0_var(--glass-shine)] backdrop-blur-md">
              <Camera className="size-5" />
            </span>
            {scanEnabled && (
              <span className="eyebrow rounded-pill border border-glass-border bg-card/50 px-3 py-1.5 text-muted-foreground backdrop-blur-md">
                AI · {site.model}
              </span>
            )}
          </div>
          <div>
            <h2 className="text-2xl sm:text-3xl">Bills or receipts</h2>
            <p className="mt-2 text-muted-foreground">
              {scanEnabled
                ? `Photos, screenshots or a PDF. Pick several files to read pages of one long bill, or up to ${MAX_BILLS} separate bills from the same occasion.`
                : "Scanning isn't configured: set NEBIUS_API_KEY in .env and restart the server."}
            </p>
          </div>
          <div className="mt-auto flex flex-col gap-3 sm:flex-row sm:items-center">
            {scanEnabled && (
              <>
                <Button size="lg" onClick={() => setScanner(true)} className="sm:hidden">
                  <Camera /> Scan with camera
                </Button>
                <Button size="lg" variant="outline" onClick={() => fileInput.current?.click()} className="sm:hidden">
                  <ImageUp /> From library
                </Button>
                <Button size="lg" onClick={() => fileInput.current?.click()} className="max-sm:hidden">
                  <ImageUp /> Upload bills
                </Button>
              </>
            )}
            {!imageOnly && (
              <Button
                variant={scanEnabled ? "link" : "default"}
                size={scanEnabled ? "default" : "lg"}
                onClick={onItemized}
                className={cn(scanEnabled && "self-center sm:self-auto")}
              >
                <ListPlus className={cn(scanEnabled && "hidden")} /> Type items instead
              </Button>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*,application/pdf,.pdf"
            multiple
            hidden
            onChange={(e) => onFiles(e.target.files)}
          />
        </div>

        {/* Single amount */}
        {!imageOnly && (
          <div className="flex flex-col gap-6 rounded-lg bg-band p-6 text-band-foreground sm:p-8">
            <span className="flex size-12 items-center justify-center rounded-full bg-white/10">
              <Hash className="size-5" />
            </span>
            <div>
              <h2 className="text-2xl sm:text-3xl">Just an amount</h2>
              <p className="mt-2 opacity-75">
                Hotel, Airbnb, fuel, tickets, a gift. Enter the total and split it equally, by shares, or exact amounts.
              </p>
            </div>
            <Button size="lg" variant="inverse" onClick={onAmount} className="mt-auto self-start max-sm:w-full">
              Enter an amount <ArrowRight />
            </Button>
          </div>
        )}
      </div>
      <CameraScanner
        open={scanner}
        mode="pages"
        onClose={() => setScanner(false)}
        onDone={(files) => {
          setScanner(false);
          void scan(files);
        }}
      />
      {scanEnabled && <ModelCard />}
      <p className="text-sm text-muted-foreground">Photos are sent to the model once to be read, and never stored. Drafts stay in this browser.</p>
    </div>
  );
}
