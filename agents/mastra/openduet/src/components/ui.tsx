"use client";

import clsx, { type ClassValue } from "clsx";
import { X } from "lucide-react";
import { twMerge } from "tailwind-merge";
import { useEffect, useId, type ButtonHTMLAttributes, type ReactNode } from "react";

// ── avatars ─────────────────────────────────────────────────────────────

/** The OpenDuet mascot: a colored blob with a face. Every bot gets one in its color. */
export function Mascot({ color, size = 40, className, asleep = false }: { color: string; size?: number; className?: string; asleep?: boolean }) {
  const light = isLight(color);
  const face = light ? "#161616" : "#101010";
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden className={className}>
      <path d="M20 2.5c9.9 0 17.5 7.4 17.5 17.1 0 10-7.7 17.9-17.5 17.9S2.5 29.6 2.5 19.6C2.5 9.9 10.1 2.5 20 2.5z" fill={color} />
      <ellipse cx="13" cy="11" rx="4.5" ry="2.6" fill="#fff" opacity="0.22" transform="rotate(-28 13 11)" />
      {asleep ? (
        <g stroke={face} strokeWidth="1.7" strokeLinecap="round" fill="none">
          <path d="M15.6 18.4c.7.8 1.5 1.1 2.3 1.1s1.6-.3 2.3-1.1" />
          <path d="M22.8 17.8c.7.8 1.5 1.1 2.3 1.1s1.6-.3 2.3-1.1" />
        </g>
      ) : (
        <g className="mascot-eyes">
          <rect x="16.2" y="14.2" width="3.4" height="6.6" rx="1.7" fill={face} />
          <rect x="23.4" y="13.6" width="3.4" height="6.6" rx="1.7" fill={face} />
        </g>
      )}
      <path d="M18.2 25.6c1.1 1.1 2.3 1.6 3.6 1.6s2.5-.5 3.6-1.6" stroke={face} strokeWidth="1.7" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** OpenDuet's mark: two mascots side by side on a white tile, a bot and
 * you, working together. */
export function DuoMark({ size = 32 }: { size?: number }) {
  const blob = Math.round(size * 0.56);
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center bg-white shadow-sm ring-1 ring-black/5"
      style={{ width: size, height: size, borderRadius: size * 0.28 }}
      aria-hidden
    >
      <Mascot color="#e0663d" size={blob} className="absolute" />
      <Mascot color="#f5cbb9" size={Math.round(blob * 0.72)} className="absolute right-[8%] bottom-[8%]" />
    </span>
  );
}

function isLight(hex: string): boolean {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return false;
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 186;
}

function BusyDot() {
  return <span className="absolute right-0 bottom-0 h-3 w-3 rounded-full border-2 border-side bg-ok" title="Working" />;
}

export function BotAvatar({ bot, size = 40, busy = false }: { bot: { color: string; name: string }; size?: number; busy?: boolean }) {
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <Mascot color={bot.color} size={size} />
      {busy && <BusyDot />}
    </span>
  );
}

/** A room is shown as two of its members huddled together. */
export function RoomAvatar({ colors, size = 40, busy = false }: { colors: string[]; size?: number; busy?: boolean }) {
  const [a = "#5a6372", b = "#8a93a3"] = colors;
  const small = Math.round(size * 0.68);
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <Mascot color={b} size={small} className="absolute top-0 left-0 opacity-90" />
      <Mascot color={a} size={small} className="absolute right-0 bottom-0" />
      {busy && <BusyDot />}
    </span>
  );
}

// ── controls ────────────────────────────────────────────────────────────

/** clsx, then let later Tailwind classes override earlier ones (a caller's `hidden` beats a base `inline-flex`). */
export const cn = (...classes: ClassValue[]) => twMerge(clsx(classes));

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40",
        size === "sm" ? "h-8 px-3.5 text-[13px]" : "h-9 px-4 text-sm",
        variant === "primary" && "bg-accent text-accent-ink hover:bg-accent-hover",
        variant === "secondary" && "bg-raised-2 text-ink hover:bg-line-strong",
        variant === "ghost" && "text-mute hover:bg-hover hover:text-ink",
        variant === "danger" && "bg-danger-soft text-danger hover:bg-[rgb(242_97_93/0.2)]",
        className,
      )}
    />
  );
}

export function IconButton({ label, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...props}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-mute transition-colors hover:bg-raised-2 hover:text-ink",
        "focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={clsx("flex items-start justify-between gap-4 py-2.5", disabled && "opacity-50")}>
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-[14px]">{label}</span>
        {hint && <span className="mt-0.5 block text-[12.5px] leading-snug text-mute">{hint}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          "relative mt-0.5 h-[22px] w-[38px] shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          checked ? "bg-accent" : "bg-line-strong",
        )}
      >
        <span className={clsx("absolute top-[3px] left-[3px] h-4 w-4 rounded-full bg-white transition-transform", checked && "translate-x-4")} />
      </button>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-medium text-mute">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[12px] leading-snug text-faint">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-xl bg-raised px-3.5 py-2.5 text-[14px] text-ink ring-1 ring-line placeholder:text-faint transition focus:ring-2 focus:ring-accent focus:outline-none";

/** Text tabs with a soft pill behind the active one. */
export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="flex items-center justify-center gap-1">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={clsx(
            "rounded-full px-3 py-1.5 text-[14px] transition-colors",
            value === t.value ? "bg-raised-2 font-medium text-ink" : "text-mute hover:text-ink",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            "rounded-xl px-3 py-2.5 text-left ring-1 transition-colors focus-visible:outline-2 focus-visible:outline-accent",
            value === o.value ? "bg-accent-soft ring-accent/60" : "bg-raised ring-line hover:bg-hover",
          )}
        >
          <span className="block text-[13.5px] font-medium">{o.label}</span>
          {o.hint && <span className="mt-0.5 block text-[12px] leading-snug text-mute">{o.hint}</span>}
        </button>
      ))}
    </div>
  );
}

/** A modal sheet from the right, for creating things and app settings. */
export function Drawer({ title, onClose, children, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button aria-label="Close" className="absolute inset-0 bg-black/25 backdrop-blur-[2px] dark:bg-black/60" onClick={onClose} />
      <aside role="dialog" aria-modal="true" className="relative flex h-full w-full max-w-[440px] flex-col border-l border-line bg-side shadow-pop">
        <header className="flex h-16 shrink-0 items-center justify-between gap-2 px-5">
          <h2 className="truncate text-[16px] font-semibold">{title}</h2>
          <IconButton label="Close" onClick={onClose} className="bg-raised">
            <X size={17} />
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">{children}</div>
        {footer && <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</footer>}
      </aside>
    </div>
  );
}
