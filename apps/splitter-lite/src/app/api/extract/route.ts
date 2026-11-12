import { ExtractionError, extractReceiptWithNebius } from "@/server/ai/nebius";
import { addUsage, costOf, emptyUsage, modelInfo, reasoningLog } from "@/server/ai/pricing";
import { reconcileReceipt } from "@/server/ai/receipt";
import { createTools } from "@/server/ai/tools";
import { aiConfig, aiGuard, apiError, readImages } from "@/server/ai/request";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Reads one bill. Send several `image` fields when they're pages of the same bill (max 4). */
export async function POST(request: Request) {
  const images = await readImages(request, 4);
  if (!images.ok) return images.response;
  const guard = aiGuard(request);
  if (!guard.ok) return guard.response;

  // The images are only held in memory for this request and never stored.
  const cfg = aiConfig();
  const usage = emptyUsage();
  const thoughts = reasoningLog();
  const started = Date.now();
  try {
    const [receipt, info] = await Promise.all([
      extractReceiptWithNebius({ ...cfg, onUsage: (u) => addUsage(usage, u), onReasoning: thoughts.add }, images.dataUrls),
      modelInfo(cfg),
    ]);
    const report = { ...usage, ms: Date.now() - started, costUsd: costOf(usage, info), reasoningText: thoughts.text() };
    if (receipt.kind === "not_a_bill") {
      return apiError(422, "This doesn't look like a bill. Upload a receipt, invoice, ticket or payment screenshot.", { usage: report });
    }
    console.info(`Bill read in ${report.ms}ms (${images.dataUrls.length} page(s), ${receipt.items.length} lines, ${usage.reasoning} reasoning tokens)`);
    // A calculator tool, run by the app: checks the bill's arithmetic.
    const check = createTools({ currency: receipt.currency ?? "USD", memberRefs: [], bills: [{ no: 1, receipt }] }).run("check_receipt", { bill: 1 }, "app");
    return Response.json({ receipt, issues: reconcileReceipt(receipt), checks: [check], usage: report });
  } catch (e) {
    if (e instanceof ExtractionError) return apiError(e.kind === "provider" ? 502 : 422, e.message, { code: e.kind });
    console.error("Unexpected extraction failure", e);
    return apiError(500, "Something went wrong reading the bill");
  }
}
