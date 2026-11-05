import Link from "next/link";

/** A ring with a dotted trail running through it, ending at a waypoint. */
function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden className="shrink-0 text-trail">
      <circle cx="13" cy="13" r="12" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M6 18c3 0 3-5 7-5s4-5 7-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="0.1 3.6" />
      <circle cx="20" cy="8" r="2.4" fill="currentColor" />
    </svg>
  );
}

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <Link href="/" className="inline-flex items-center gap-2.5 text-fg" aria-label="Codetrail home">
      <LogoMark size={compact ? 22 : 26} />
      {!compact && <span className="font-display text-[16px] font-bold tracking-tight [font-stretch:85%]">codetrail</span>}
    </Link>
  );
}
