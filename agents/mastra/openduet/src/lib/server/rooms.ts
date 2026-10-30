// Group rooms: decide who answers, give each bot the part of the room it
// hasn't seen, and let a bot hand off to a teammate by @mentioning them.
import type { Bot, ChatMessage, Room, RouteNote } from "@/lib/shared/types";
import { listBots, listMessages } from "./db";
import { pickResponders } from "./jev";
import { runTurn, stopEpochOf } from "./runtime";

/** How many bot-to-bot @mention hops one message from the person can start. */
const MAX_HANDOFF_DEPTH = 2;

export function roomConversationId(roomId: string) {
  return `room:${roomId}`;
}

export function messageText(message: ChatMessage): string {
  return message.parts
    .filter((p) => p.kind === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n")
    .trim();
}

function mentionsIn(text: string, members: Bot[]): Bot[] {
  const handles = new Set([...text.matchAll(/@([a-z0-9_-]+)/gi)].map((m) => m[1].toLowerCase()));
  return members.filter((b) => handles.has(b.handle) || handles.has(b.name.toLowerCase()));
}

function authorName(message: ChatMessage, bots: Map<string, Bot>): string {
  if (message.role === "user") return "Person";
  return bots.get(message.botId ?? "")?.name ?? "A former member";
}

/** Everything in the room since this bot last spoke (at most the last 30 lines). */
function catchUp(history: ChatMessage[], bot: Bot, bots: Map<string, Bot>): string[] {
  let start = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].botId === bot.id && history[i].role === "bot") {
      start = i + 1;
      break;
    }
  }
  return history
    .slice(start)
    .filter((m) => m.role !== "notice" && m.status !== "streaming")
    .slice(-30)
    .map((m) => `${authorName(m, bots)}: ${messageText(m) || "(no text)"}`);
}

function roomPrompt(room: Room, bot: Bot, members: Bot[], lines: string[], handoff: boolean): string {
  const roster = members
    .map((b) => `- ${b.name} (@${b.handle})${b.title ? `, ${b.title}` : ""}${b.id === bot.id ? " (you)" : ""}`)
    .join("\n");
  return [
    `[Group room "${room.name}"${room.topic ? `, topic: ${room.topic}` : ""}]`,
    `Members:\n${roster}`,
    `New in the room since your last message:\n${lines.join("\n") || "(nothing new)"}`,
    "---",
    handoff
      ? `A teammate @mentioned you. Do the part they asked of you, as ${bot.name}.`
      : `Reply to the latest message as ${bot.name}.`,
    "Add only your part; don't repeat what teammates already said. To hand something to a teammate, @mention their handle.",
  ].join("\n\n");
}

async function decideResponders(room: Room, members: Bot[], text: string, history: ChatMessage[], bots: Map<string, Bot>) {
  const lead = members.find((b) => b.id === room.leadId) ?? members[0];
  if (/@(everyone|all)\b/i.test(text) || room.responder === "everyone") {
    return { bots: members, route: { by: "everyone" } as RouteNote };
  }
  const mentioned = mentionsIn(text, members);
  if (mentioned.length) return { bots: mentioned, route: { by: "mention" } as RouteNote };
  if (room.responder === "auto") {
    const lines = history.slice(-9, -1).map((m) => `${authorName(m, bots)}: ${messageText(m).slice(0, 300)}`);
    const pick = await pickResponders(room, members, lines, text);
    if (pick) {
      return {
        bots: members.filter((b) => pick.botIds.includes(b.id)),
        route: { by: "jev", confidence: pick.confidence } as RouteNote,
      };
    }
  }
  return { bots: lead ? [lead] : [], route: { by: "lead" } as RouteNote };
}

/** Handle the person's new room message: route it, then run each responder in turn. */
export async function runRoom(room: Room, userMessage: ChatMessage): Promise<void> {
  const allBots = await listBots();
  const bots = new Map(allBots.map((b) => [b.id, b]));
  const members = room.memberIds.map((id) => bots.get(id)).filter((b): b is Bot => Boolean(b));
  if (!members.length) return;

  const conversationId = roomConversationId(room.id);
  const epoch = stopEpochOf(conversationId);
  const history = await listMessages(conversationId, 60);
  const { bots: responders, route } = await decideResponders(room, members, messageText(userMessage), history, bots);

  const queue: Array<{ bot: Bot; route: RouteNote; depth: number }> = responders.map((bot) => ({ bot, route, depth: 0 }));
  while (queue.length && stopEpochOf(conversationId) === epoch) {
    const { bot, route: note, depth } = queue.shift()!;
    const transcript = await listMessages(conversationId, 60);
    const reply = await runTurn({
      bot,
      conversationId,
      content: roomPrompt(room, bot, members, catchUp(transcript, bot, bots), note.by === "handoff"),
      route: note,
    });
    if (!reply || reply.status !== "done" || depth >= MAX_HANDOFF_DEPTH) continue;
    for (const next of mentionsIn(messageText(reply), members)) {
      if (next.id === bot.id || queue.some((q) => q.bot.id === next.id)) continue;
      queue.push({ bot: next, route: { by: "handoff" }, depth: depth + 1 });
    }
  }
}
