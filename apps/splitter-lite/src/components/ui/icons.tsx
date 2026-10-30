import { House, PartyPopper, Plane, Shapes, Ticket, UtensilsCrossed, type LucideIcon } from "lucide-react";
import type { SVGProps } from "react";
import type { GroupKind } from "@/config/categories";

// Header icon set: 24px grid, 1.75 stroke, round joins, drawn to sit with lucide.
type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/** A receipt torn down the middle: one bill, split. */
export function QuickSplitIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 3.5h14v17l-2.33-1.5-2.34 1.5L12 19l-2.33 1.5L7.33 19 5 20.5z" />
      <path d="M12 6.5v2.25M12 11v2.25M12 15.5v1" />
      <path d="M8 8h1.5M8 11.5h1.5M14.5 8H16M14.5 11.5H16" />
    </Icon>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 9.5a6 6 0 0 1 12 0c0 3.6.9 5.6 1.8 6.7.3.4 0 .8-.4.8H4.6c-.4 0-.7-.4-.4-.8.9-1.1 1.8-3.1 1.8-6.7z" />
      <path d="M10 20a2.2 2.2 0 0 0 4 0" />
    </Icon>
  );
}

/** Ring gauge: track plus an arc for `value` (0–1), starting at 12 o'clock. */
export function RingGauge({ value, className }: { value: number; className?: string }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  const v = Math.min(1, Math.max(0, value));
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r={r} stroke="currentColor" strokeOpacity={0.18} strokeWidth={3} />
      <circle
        cx="12"
        cy="12"
        r={r}
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={`${c * v} ${c}`}
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
}

const GROUP_KIND_ICONS = { trip: Plane, party: PartyPopper, event: Ticket, home: House, dinner: UtensilsCrossed, other: Shapes } satisfies Record<
  GroupKind,
  LucideIcon
>;

/** Line icon for a group type; replaces the emoji in pickers. */
export function GroupKindIcon({ kind, className }: { kind: GroupKind; className?: string }) {
  const Glyph = GROUP_KIND_ICONS[kind];
  return <Glyph aria-hidden strokeWidth={1.75} className={className} />;
}

/** The "Settle with AI" mark: a large curved four-point star with a small companion, filled. */
export function AiSparkIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M10 3.5c.4 3.9 2.6 6.1 6.5 6.5-3.9.4-6.1 2.6-6.5 6.5-.4-3.9-2.6-6.1-6.5-6.5 3.9-.4 6.1-2.6 6.5-6.5Z" />
      <path d="M18 14.5c.2 1.9 1.1 2.8 3 3-1.9.2-2.8 1.1-3 3-.2-1.9-1.1-2.8-3-3 1.9-.2 2.8-1.1 3-3Z" opacity="0.75" />
    </svg>
  );
}
