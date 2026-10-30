// Room routing with Jev, TypeSafe's System One decision model. Jev answers a
// typed multiple-choice question in a few hundred milliseconds; it never does
// the work itself. Any failure (no key, timeout, HTTP error, odd answer) returns
// null and the room falls back to its lead.
import type { Bot, Room } from "@/lib/shared/types";

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const TIMEOUT_MS = 2500;
/** Below this, Jev isn't sure enough and the lead answers. */
export const JEV_MIN_PROBABILITY = 0.55;
const SEVERAL = "several_members";

export interface JevPick {
  botIds: string[];
  confidence: number;
}

interface JevChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities?: Record<string, number>;
  confidence?: number;
}

export async function pickResponders(room: Room, members: Bot[], recentLines: string[], message: string): Promise<JevPick | null> {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey || members.length === 0) return null;

  const criteria: Record<string, string> = {};
  for (const bot of members) {
    criteria[bot.id] = `${bot.name}${bot.title ? `, ${bot.title}` : ""}: ${bot.description || "general teammate"}`.slice(0, 300);
  }
  if (members.length > 1) criteria[SEVERAL] = "Several members should each answer (the message asks everyone, or clearly spans several roles)";

  const state = [
    `Room: ${room.name}${room.topic ? ` (${room.topic})` : ""}`,
    `Members: ${members.map((b) => b.name).join(", ")}`,
    recentLines.length ? `Recent messages:\n${recentLines.slice(-8).join("\n")}` : "",
    `New message from the person: ${message}`,
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 6000);

  try {
    const res = await fetch(JEV_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.JEV_MODEL || "jev-latest",
        state,
        questions: {
          responder: {
            type: "choice",
            instructions: "Which room member should answer the person's new message?",
            criteria,
          },
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { answers?: { responder?: JevChoiceAnswer } };
    const answer = json.answers?.responder;
    if (!answer || answer.type !== "choice") return null;
    const p = answer.probabilities?.[answer.choice] ?? answer.confidence ?? 0;
    if (p < JEV_MIN_PROBABILITY) return null;
    if (answer.choice === SEVERAL) return { botIds: members.map((b) => b.id), confidence: p };
    if (!members.some((b) => b.id === answer.choice)) return null;
    return { botIds: [answer.choice], confidence: p };
  } catch {
    return null;
  }
}
