import { z } from "zod";
import { ExtractionError, ToolsUnsupportedError } from "@/server/ai/nebius";
import { modelInfo } from "@/server/ai/pricing";
import { aiConfig, aiGuard, apiError } from "@/server/ai/request";
import { runSplitAgent } from "@/server/ai/split-agent";

export const runtime = "nodejs";
export const maxDuration = 120;

const money = z.number().finite().nullable();
const receipt = z.object({
  merchant: z.string().max(200).nullable(),
  currency: z.string().max(3).nullable(),
  items: z.array(z.object({ name: z.string().max(200), quantity: z.number().finite(), totalPrice: z.number().finite() })).min(1).max(200),
  subtotal: money,
  tax: money,
  tip: money,
  serviceCharge: money,
  discount: money,
  total: money,
});
const body = z
  .object({
    receipts: z.array(receipt).min(1).max(2),
    people: z.array(z.object({ id: z.string().max(40), name: z.string().trim().min(1).max(60) })).min(1).max(20),
    note: z.string().max(2000).optional(),
    lines: z.array(z.object({ bill: z.number().int().min(1).max(2), line: z.number().int().min(1), members: z.array(z.string().max(40)).min(1) })).optional(),
  })
  .refine((b) => b.note?.trim() || b.lines, "Send a note or the line assignment");

/** The model splits one bill with its own calculator tool calls; the app validates the result. */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "Invalid request");
  const guard = aiGuard(request);
  if (!guard.ok) return guard.response;

  const { receipts, ...rest } = parsed.data;
  const cfg = aiConfig();
  try {
    const result = await runSplitAgent(
      cfg,
      { ...rest, receipts: receipts.map((r) => ({ kind: "receipt" as const, category: null, date: null, suggestedTips: [], paidByHint: null, ...r })) },
      await modelInfo(cfg),
    );
    return Response.json(result);
  } catch (e) {
    if (e instanceof ToolsUnsupportedError) return apiError(502, "This model endpoint rejected tool calls.");
    if (e instanceof ExtractionError) return apiError(e.kind === "provider" ? 502 : 422, e.message, { code: e.kind });
    console.error("Unexpected split failure", e);
    return apiError(500, "Something went wrong splitting the bill");
  }
}
