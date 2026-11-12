// Hard limits on what a bot may do in connected apps, checked when a tool runs.
// Approval can't lift them: trading, moving money, and sending card numbers or
// government ID numbers out of the app.
import type { ToolsInput } from "@mastra/core/agent";

/** Apps where placing an order means trading securities or crypto. */
const BROKERAGES = /^(alpaca|robinhood|coinbase|binance|kraken|etrade|schwab|interactive_?brokers|ibkr|webull|tradier|gemini|public)$/;
/** Apps that hold money, where a transfer or payout moves it. */
const MONEY_APPS = /^(stripe|plaid|paypal|wise|mercury|brex|ramp|square|venmo|revolut|coinbase|quickbooks|xero|gusto|bank|chase|wells)/;

const TRADING_ACTION = /(^|_)(trades?|orders?|buy|sell|positions?)(_|$)/;
const MONEY_ACTION = /(^|_)(transfers?|payouts?|withdraw(al)?s?|wire|send_money|move_money|ach)(_|$)/;
/** Unambiguous in any app, for MCP tools where the app isn't known. */
const ANY_APP_TRADING = /(^|_)(trades?|place_order_(stock|crypto|option)s?|place_(stock|crypto|options?)_orders?|close_(all_)?positions?)(_|$)/;
const ANY_APP_MONEY = /(^|_)(payouts?|withdraw(al)?s?|wire_transfer|bank_transfer|send_money|move_money)(_|$)/;

const TRADING = "Trading securities or crypto is off limits for bots, even with your approval.";
const MOVING_MONEY = "Moving money between accounts is off limits for bots, even with your approval.";

/** Why this app action is off limits, or null when it may run. `app` is
 * Composio's toolkit ("stripe"), or undefined for an MCP tool. */
export function offLimits(app: string | undefined, action: string): string | null {
  // MCP tools use any naming style: placeStockOrder and place-stock-order become place_stock_order.
  const a = action.replace(/([a-z\d])([A-Z])/g, "$1_$2").replace(/[-\s]+/g, "_").toLowerCase();
  // Reading a balance or an order history is fine; only actions that create or send are blocked.
  if (/^(get|list|search|read|fetch|find|view|retrieve)(_|$)/.test(a) && !/(^|_)(create|send|submit|place|execute|initiate|make|post)(_|$)/.test(a)) {
    return null;
  }
  if (ANY_APP_TRADING.test(a) || (app && BROKERAGES.test(app) && TRADING_ACTION.test(a))) return TRADING;
  if (ANY_APP_MONEY.test(a) || (app && MONEY_APPS.test(app) && MONEY_ACTION.test(a))) return MOVING_MONEY;
  return null;
}

/** Card numbers start with a network prefix and pass the Luhn check; this
 * catches them with spaces or dashes too. */
function looksLikeCard(text: string): boolean {
  for (const match of text.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) {
    const digits = match[0].replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19) continue;
    if (!/^(4|5[1-5]|2[2-7]|3[47]|6011|65|35)/.test(digits)) continue;
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let d = Number(digits[digits.length - 1 - i]);
      if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
      sum += d;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}

/** US Social Security numbers in their usual written form. */
const SSN = /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/;

/** Why these arguments can't leave the app, or null. */
export function sensitiveData(args: unknown): string | null {
  let text: string;
  try {
    text = typeof args === "string" ? args : JSON.stringify(args ?? "");
  } catch {
    return null;
  }
  if (looksLikeCard(text)) return "That includes what looks like a card number. Bots don't send card numbers to other apps.";
  if (SSN.test(text)) return "That includes what looks like a Social Security number. Bots don't send government ID numbers to other apps.";
  return null;
}

/** "STRIPE_CREATE_PAYOUT" → ["stripe", "create_payout"], matching the longest
 * connected toolkit so multi-word apps ("zoho_books") split in the right place. */
function splitSlug(slug: string, apps: string[]): [string, string] {
  const s = slug.toLowerCase();
  const app = apps.filter((a) => s.startsWith(`${a}_`)).sort((x, y) => y.length - x.length)[0];
  if (app) return [app, s.slice(app.length + 1)];
  const [first, ...rest] = s.split("_");
  return [first, rest.join("_")];
}

/** The app actions one tool call would run, as [app, action]. */
function actionsIn(toolName: string, args: unknown, apps: string[]): Array<[string | undefined, string]> {
  if (/^COMPOSIO_MULTI_EXECUTE/.test(toolName)) {
    const tools = (args as { tools?: Array<{ tool_slug?: string }> } | null)?.tools;
    if (!Array.isArray(tools)) return [];
    return tools.map((t) => splitSlug(String(t?.tool_slug ?? ""), apps));
  }
  if (toolName.startsWith("COMPOSIO_")) return [];
  // mcp_<serverId>_<action>
  if (toolName.startsWith("mcp_")) return [[undefined, toolName.split("_").slice(2).join("_")]];
  return [[undefined, toolName]];
}

/** `apps` are the Composio toolkits connected for this bot. */
export function checkToolCall(toolName: string, args: unknown, apps: string[] = []): string | null {
  // The remote workbench runs code that can call any action in any connected
  // account, which can't be checked from its text, so it's always off.
  if (toolName.startsWith("COMPOSIO_REMOTE")) {
    return "Running code against connected apps is off. Run the actions one at a time with COMPOSIO_MULTI_EXECUTE_TOOL instead.";
  }
  for (const [app, action] of actionsIn(toolName, args, apps)) {
    const reason = offLimits(app, action);
    if (reason) return reason;
  }
  return sensitiveData(args);
}

/** Wrap each connected-app tool so a blocked call returns the reason instead of running. */
export function guardTools(tools: ToolsInput, apps: string[]): void {
  for (const [name, tool] of Object.entries(tools)) {
    const t = tool as { execute?: (input: unknown, context: unknown) => Promise<unknown> };
    const run = t.execute;
    if (typeof run !== "function") continue;
    t.execute = async (input, context) => {
      const reason = checkToolCall(name, input, apps);
      if (reason) return { error: reason, blocked: true };
      return run.call(tool, input, context);
    };
  }
}
