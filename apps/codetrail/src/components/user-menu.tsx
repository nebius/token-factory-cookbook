"use client";

// Sign-in state and today's free quota (hosted app only; nothing shows when AUTH_MODE=none).
import { LogOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/trail/dialog";
import { authClient } from "@/lib/auth-client";

type Me = { mode: "none" | "github"; viewer: { id: string; name: string; image: string | null } | null; usage: { reads: number; asks: number } | null; limits: { reads: number; asks: number } };

function Github({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className} fill="currentColor">
      <path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.22.48-2.69-1.07-2.69-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.23.83 1.23.83.72 1.23 1.88.87 2.34.67.07-.52.28-.87.5-1.07-1.77-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0Z" />
    </svg>
  );
}

const signInWithGitHub = () => authClient.signIn.social({ provider: "github", callbackURL: window.location.href });

export function UserMenu() {
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // Escape or a click outside closes it; Escape puts focus back on the button.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => {});
  }, []);
  if (!me || me.mode !== "github") return null;
  if (!me.viewer) {
    return (
      <button onClick={signInWithGitHub} className="inline-flex items-center gap-1.5 rounded-[10px] border border-line bg-panel px-3 py-1.5 text-[12.5px] text-fg hover:border-outline">
        <Github className="size-3.5" /> Sign in
      </button>
    );
  }
  const left = { reads: Math.max(0, me.limits.reads - (me.usage?.reads ?? 0)), asks: Math.max(0, me.limits.asks - (me.usage?.asks ?? 0)) };
  return (
    <div ref={box} className="relative">
      <button
        ref={button}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="user-panel"
        aria-label={`${me.viewer.name}: ${left.reads}/${me.limits.reads} · ${left.asks}/${me.limits.asks} reads and questions left today`} className="flex items-center gap-2 rounded-[10px] border border-line bg-panel py-1 pr-2.5 pl-1 text-[12.5px] text-fg-2 hover:border-outline">
        {me.viewer.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={me.viewer.image} alt="" className="size-6 rounded-full" />
        ) : (
          <span className="size-6 rounded-full bg-raised" />
        )}
        <span className="hidden font-mono sm:inline">
          {left.reads}/{me.limits.reads} · {left.asks}/{me.limits.asks}
        </span>
      </button>
      {open && (
        <div id="user-panel" className="absolute right-0 z-50 mt-2 w-64 rounded-card border border-line bg-panel p-3 text-[13px] shadow-xl">
          <p className="font-medium text-fg">{me.viewer.name}</p>
          <p className="mt-2 text-fg-2">Free today, resets at midnight UTC:</p>
          <p className="mt-1 font-mono text-[12px] text-fg-2">
            {left.reads} of {me.limits.reads} new repo reads left
            <br />
            {left.asks} of {me.limits.asks} questions left
          </p>
          <p className="mt-2 text-[12px] text-fg-3">Stored repos and tours are always free.</p>
          <button onClick={() => authClient.signOut().then(() => window.location.reload())} className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] text-fg-2 hover:text-fg">
            <LogOut className="size-3.5" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function SignInModal({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Sign in to read a new repo" onClose={onClose}>
      <p className="text-[14px] leading-relaxed text-fg-2">
        Reading a new repo or asking a question runs the model on our account. Sign in with GitHub for free daily reads and questions. Stored repos, tours and docs
        stay free without signing in.
      </p>
      <button onClick={signInWithGitHub} className="mt-5 flex w-full items-center justify-center gap-2 rounded-[12px] bg-trail px-4 py-3 font-semibold text-[#16171a] hover:bg-trail-strong">
        <Github className="size-4" /> Sign in with GitHub
      </button>
      <p className="mt-3 text-center text-[12px] text-fg-3">Or self-host Codetrail with your own Nebius key: no sign-in, no limits.</p>
    </Dialog>
  );
}
