// Desktop notifications for what a bot did on its own or needs from you,
// shown when the app isn't in front of you. Opt-in, remembered per browser.
import type { ChatMessage, ConversationId } from "@/lib/shared/types";
import { messagePreview } from "./format";

const KEY = "openduet:notify";

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationsOn(): boolean {
  try {
    return notificationsSupported() && Notification.permission === "granted" && localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Turn notifications on (asking the browser if needed) or off. Resolves to the new state. */
export async function setNotifications(on: boolean): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (on && Notification.permission !== "granted") {
    if ((await Notification.requestPermission()) !== "granted") return false;
  }
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // storage may be unavailable
  }
  return notificationsOn();
}

const shown = new Set<string>();

/** Notify about one message update, at most once per thing worth knowing. */
export function notifyFor(message: ChatMessage, botName: string, active: ConversationId | null, onOpen: (id: ConversationId) => void) {
  if (message.role !== "bot" || !notificationsOn()) return;
  const hidden = document.hidden;
  const elsewhere = hidden || active !== message.conversationId;
  const routine = message.route?.by === "brief" || message.route?.by === "check";

  let tag: string;
  let title: string;
  let body: string;
  const waiting = message.parts.find(
    (p) => (p.kind === "tool" && p.status === "awaiting-approval") || (p.kind === "question" && p.answer === undefined),
  );
  if (waiting && elsewhere) {
    tag = `${message.id}:${"toolCallId" in waiting ? waiting.toolCallId : ""}`;
    title = waiting.kind === "question" ? `${botName} has a question` : `${botName} needs your OK`;
    body = waiting.kind === "question" ? waiting.question : waiting.kind === "tool" ? [waiting.label, waiting.detail].filter(Boolean).join(": ") : "";
  } else if (message.status === "done" && ((routine && elsewhere) || hidden)) {
    tag = message.id;
    title = message.route?.by === "brief" ? `${botName}: your brief` : routine ? `${botName} found something` : `${botName} replied`;
    body = messagePreview(message);
  } else {
    return;
  }
  if (shown.has(tag)) return;
  shown.add(tag);
  try {
    const n = new Notification(title, { body: body.slice(0, 180), tag });
    n.onclick = () => {
      window.focus();
      onOpen(message.conversationId);
      n.close();
    };
  } catch {
    // Some browsers only allow notifications from a service worker.
  }
}
