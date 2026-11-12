"use client";

import { Square, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Tip } from "./Tip";

/** Reads text aloud with the browser's built-in voice. No network, no model call. */
export function ReadAloud({ text, label = "Read to me", compact = false }: { text: string; label?: string; compact?: boolean }) {
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window);
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);
  useEffect(() => {
    // Stop when the text changes (another part was picked).
    if (speaking) window.speechSynthesis.cancel();
    setSpeaking(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  if (!supported) return null;
  const toggle = () => {
    const s = window.speechSynthesis;
    if (speaking) {
      s.cancel();
      setSpeaking(false);
      return;
    }
    s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    const voice = s.getVoices().find((v) => /en[-_](US|GB)/i.test(v.lang) && /natural|samantha|google|daniel/i.test(v.name)) ?? s.getVoices().find((v) => v.lang.startsWith("en"));
    if (voice) u.voice = voice;
    u.onend = u.onerror = () => setSpeaking(false);
    s.speak(u);
    setSpeaking(true);
  };
  return (
    <Tip text={speaking ? "Stop reading" : "Hear this read out loud"}>
      <button className={`btn btn-sm ${compact ? "btn-icon" : ""}`} onClick={toggle} aria-pressed={speaking} style={speaking ? { borderColor: "var(--hi)", color: "var(--hi)" } : undefined}>
        {speaking ? <Square size={14} /> : <Volume2 size={15} />}
        {!compact && (speaking ? "Stop" : label)}
      </button>
    </Tip>
  );
}
