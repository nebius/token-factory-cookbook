import Link from "next/link";
import { site } from "@/config/site";
import { cn } from "@/lib/utils";

// The mark: a pie with one slice taken out. Shared things, fairly split.
export const MARK_PATHS = {
  pie: "M30 14A18 18 0 1 0 50 34H30Z",
  slice: "M34.5 10.5A20 20 0 0 1 53.5 29.5H34.5Z",
};

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn("size-7", className)}>
      <rect width="64" height="64" rx="16" className="fill-primary" />
      <path d={MARK_PATHS.pie} className="fill-primary-foreground" />
      <path d={MARK_PATHS.slice} className="fill-accent" />
    </svg>
  );
}

export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn("flex items-center gap-2.5 font-display text-xl tracking-tight", className)}>
      <LogoMark />
      {site.name}
    </Link>
  );
}
