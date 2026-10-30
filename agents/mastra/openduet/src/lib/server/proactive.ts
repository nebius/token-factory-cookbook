// Bots that work when you're away: a daily brief and quiet check-ins on the
// connected apps, posted in the bot's own chat. A check-in that finds nothing
// leaves no message. Both run in the bot's routine lane (see runtime.ts), where
// anything that acts on an account waits for approval, even with full access.
import type { Bot, RoutineKind, UpcomingRoutine } from "@/lib/shared/types";
import { publish } from "./bus";
import { getBot, getSetting, listBots, setSetting } from "./db";
import { InputError } from "./errors";
import { listServers } from "./mcp-servers";
import { NOTHING_TO_REPORT, routineBusy, runTurn } from "./runtime";

/** How long after its set time a missed brief still goes out (e.g. the laptop was asleep). */
const BRIEF_WINDOW_MINUTES = 4 * 60;
/** Scheduled check-ins pause overnight, local time. */
const QUIET_HOURS = { from: 22, to: 7 };
const TICK_MS = 60_000;

interface RoutineState {
  /** Local date of the last brief, "YYYY-MM-DD". */
  lastBrief?: string;
  /** When the last check-in (or brief) ran, ISO. */
  lastCheck?: string;
}

const stateKey = (botId: string) => `proactive.${botId}`;

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function briefDue(bot: Bot, seen: RoutineState, now: Date): boolean {
  if (!bot.proactive.brief || seen.lastBrief === localDate(now)) return false;
  const since = now.getHours() * 60 + now.getMinutes() - minutesOf(bot.proactive.briefAt);
  return since >= 0 && since < BRIEF_WINDOW_MINUTES;
}

/** A check-in needs something to look at: connected apps, or the web. */
const canCheck = (bot: Bot) => bot.connections.length > 0 || bot.tools.webSearch;

function checkDue(bot: Bot, seen: RoutineState, now: Date): boolean {
  const hours = bot.proactive.checkEveryHours;
  if (!hours || !canCheck(bot)) return false;
  const hour = now.getHours();
  if (hour >= QUIET_HOURS.from || hour < QUIET_HOURS.to) return false;
  return !seen.lastCheck || now.getTime() - Date.parse(seen.lastCheck) >= hours * 3600_000;
}

async function sourcesOf(bot: Bot): Promise<string> {
  const servers = new Map((await listServers()).map((s) => [s.id, s.name]));
  const names = bot.connections.map((c) => {
    const [kind, id] = c.split(":");
    return kind === "mcp" ? (servers.get(id) ?? id) : id.charAt(0).toUpperCase() + id.slice(1);
  });
  if (names.length) return `your connected apps (${names.join(", ")})`;
  return bot.tools.webSearch ? "the web" : "your memory";
}

async function routinePrompt(bot: Bot, kind: RoutineKind, scheduled: boolean): Promise<string> {
  const now = new Date().toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" });
  const sources = await sourcesOf(bot);
  const watchFor = bot.proactive.watchFor.trim();
  const lines =
    kind === "brief"
      ? [
          `[Brief] It's ${now}. Write the person's brief for today.`,
          `Go through ${sources} and your memory. Pick the few things that need them today, most important first. For each: what it is, why it matters, and the next step you can take for them.`,
          watchFor ? `They want to hear about: ${watchFor}` : "",
          bot.connections.length ? "" : "You have no connected apps yet. Add one line at the end saying that connecting apps in Connections makes this brief more useful.",
          "Read and draft as much as you need, but don't send, post, pay, sign or delete anything: offer to.",
          "Keep it short enough to read in a minute.",
        ]
      : [
          `[Check-in] It's ${now}. Look over ${sources} for anything new since your last check-in that needs the person.`,
          watchFor ? `They want to hear about: ${watchFor}` : "",
          "Don't repeat what you already told them. Read and draft only; don't act.",
          scheduled
            ? `If nothing needs them, reply with exactly ${NOTHING_TO_REPORT} and nothing else. Otherwise write a short note: what happened, why it matters, and what you can do about it.`
            : "Write a short note: what happened, why it matters, and what you can do about it. If nothing needs them, say so in one line.",
        ];
  return lines.filter(Boolean).join("\n");
}

async function runRoutine(bot: Bot, kind: RoutineKind, scheduled: boolean): Promise<void> {
  const now = new Date();
  const seen = (await getSetting<RoutineState>(stateKey(bot.id))) ?? {};
  // Record the run first, so a failing model doesn't retry every minute.
  await setSetting(stateKey(bot.id), {
    ...seen,
    lastCheck: now.toISOString(),
    ...(kind === "brief" ? { lastBrief: localDate(now) } : {}),
  } satisfies RoutineState);
  publish({ type: "routines-changed" });
  await runTurn({
    bot,
    conversationId: `dm:${bot.id}`,
    content: await routinePrompt(bot, kind, scheduled),
    // A scheduled check-in only shows up when it found something.
    route: { by: kind, ...(scheduled && kind === "check" ? { found: true } : {}) },
    routine: true,
    quiet: scheduled && kind === "check",
  });
}

/** "Brief me now" / "Check now" from the bot's Details. */
export async function runRoutineNow(botId: string, kind: RoutineKind): Promise<void> {
  if (kind !== "brief" && kind !== "check") throw new InputError("Unknown routine.");
  const bot = await getBot(botId);
  if (!bot) throw new InputError("That bot doesn't exist.");
  if (routineBusy(bot.id)) throw new InputError(`${bot.name} is already working on a brief or check-in.`);
  void runRoutine(bot, kind, false).catch((error) => console.error("[openduet] routine", error));
}

/** The next local time at or after `from` that's outside quiet hours. */
function afterQuietHours(from: Date): Date {
  const d = new Date(from);
  if (d.getHours() >= QUIET_HOURS.from) d.setDate(d.getDate() + 1);
  if (d.getHours() >= QUIET_HOURS.from || d.getHours() < QUIET_HOURS.to) d.setHours(QUIET_HOURS.to, 0, 0, 0);
  return d;
}

/** When each bot's next brief and check-in should run, soonest first. */
export async function upcomingRoutines(): Promise<UpcomingRoutine[]> {
  const now = new Date();
  const out: UpcomingRoutine[] = [];
  for (const bot of await listBots()) {
    const { brief, briefAt, checkEveryHours } = bot.proactive;
    if (!brief && !checkEveryHours) continue;
    const seen = (await getSetting<RoutineState>(stateKey(bot.id))) ?? {};
    if (brief) {
      const [h, m] = briefAt.split(":").map(Number);
      const at = new Date(now);
      at.setHours(h, m, 0, 0);
      // Done today, or today's window has passed: tomorrow. A due brief shows as now.
      if (seen.lastBrief === localDate(now) || now.getTime() - at.getTime() >= BRIEF_WINDOW_MINUTES * 60_000) at.setDate(at.getDate() + 1);
      else if (at < now) at.setTime(now.getTime());
      out.push({ botId: bot.id, kind: "brief", at: at.toISOString() });
    }
    if (checkEveryHours && canCheck(bot)) {
      const due = seen.lastCheck ? new Date(Date.parse(seen.lastCheck) + checkEveryHours * 3600_000) : now;
      out.push({ botId: bot.id, kind: "check", at: afterQuietHours(due < now ? now : due).toISOString() });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

async function tick(): Promise<void> {
  const now = new Date();
  for (const bot of await listBots()) {
    if ((!bot.proactive.brief && !bot.proactive.checkEveryHours) || routineBusy(bot.id)) continue;
    const seen = (await getSetting<RoutineState>(stateKey(bot.id))) ?? {};
    const kind = briefDue(bot, seen, now) ? "brief" : checkDue(bot, seen, now) ? "check" : null;
    if (kind) void runRoutine(bot, kind, true).catch((error) => console.error("[openduet] routine", error));
  }
}

const g = globalThis as unknown as { __openduetScheduler?: ReturnType<typeof setInterval> };

/** Started once per server from instrumentation.ts. Runs whether or not a browser is open. */
export function startScheduler(): void {
  if (g.__openduetScheduler) clearInterval(g.__openduetScheduler);
  const run = () => {
    // Boot first, so a restart sweeps interrupted turns before a routine starts.
    void import("./service")
      .then(({ boot }) => boot())
      .then(tick)
      .catch((error) => console.error("[openduet] scheduler", error));
  };
  g.__openduetScheduler = setInterval(run, TICK_MS);
  g.__openduetScheduler.unref?.();
}
