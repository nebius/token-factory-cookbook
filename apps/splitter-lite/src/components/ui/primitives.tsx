import * as React from "react";
import { categoryOf } from "@/config/categories";
import { avatarColor, cn, initials } from "@/lib/utils";

/** Flat surface. `tone="stone"` is the design system's product-card; default is a bordered white card. */
export function Card({ className, tone = "plain", ...props }: React.ComponentProps<"div"> & { tone?: "plain" | "stone" }) {
  return (
    <div
      className={cn(
        "rounded-md text-card-foreground",
        tone === "stone" ? "bg-stone" : "border border-border bg-card",
        className,
      )}
      {...props}
    />
  );
}

export function Eyebrow({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("eyebrow text-muted-foreground", className)} {...props} />;
}

const control =
  "w-full min-w-0 rounded-xs border border-input bg-card text-base outline-none transition placeholder:text-subtle focus-visible:border-[#9b60aa] focus-visible:ring-2 focus-visible:ring-[#9b60aa]/20 disabled:opacity-50 aria-invalid:border-negative";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  // text-base keeps iOS from zooming into focused inputs.
  return <input className={cn(control, "h-12 px-3.5 md:h-11 md:text-sm", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-24 resize-y px-3.5 py-3 md:text-sm", className)} {...props} />;
}

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        control,
        "h-12 appearance-none bg-[length:16px] bg-[right_12px_center] bg-no-repeat px-3.5 pr-9 md:h-11 md:text-sm",
        "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2393939f' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]",
        className,
      )}
      {...props}
    />
  );
}

/** Wrapping <label> associates the text with the control inside it for screen readers and clicks. */
export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("grid gap-1.5", className)}>
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function Badge({
  className,
  tone = "neutral",
  ...props
}: React.ComponentProps<"span"> & { tone?: "neutral" | "positive" | "negative" | "accent" | "warning" }) {
  const tones = {
    neutral: "bg-muted text-muted-foreground",
    positive: "bg-positive-soft text-positive",
    negative: "bg-negative-soft text-negative",
    accent: "bg-accent-soft text-accent-ink",
    warning: "bg-warning-soft text-warning",
  };
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium", tones[tone], className)}
      {...props}
    />
  );
}

/** Coral taxonomy chip (the design system blog-filter-chip, scaled down). */
export function CategoryChip({
  category,
  active,
  className,
  ...props
}: React.ComponentProps<"button"> & { category: string; active?: boolean }) {
  const { label, icon: Icon } = categoryOf(category);
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex h-11 shrink-0 items-center gap-2 rounded-sm border px-3.5 text-sm transition md:h-10",
        active ? "border-accent bg-accent text-[#17171c]" : "border-accent/50 bg-accent-soft/40 text-accent-ink hover:border-accent",
        className,
      )}
      {...props}
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}

export function CategoryIcon({ category, className }: { category: string; className?: string }) {
  const { icon: Icon, label } = categoryOf(category);
  return (
    <span title={label} className={cn("flex size-10 shrink-0 items-center justify-center rounded-sm bg-stone text-foreground", className)}>
      <Icon className="size-4" />
    </span>
  );
}

export function Avatar({
  name,
  src,
  className,
  size = "md",
}: {
  name: string;
  /** Profile photo URL; falls back to initials. */
  src?: string | null;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const sizes = { sm: "size-6 text-[10px]", md: "size-8 text-xs", lg: "size-11 text-sm" };
  if (src) {
    // Plain <img>: the photo route is private and auth-gated, so next/image optimisation doesn't apply.
    return <img src={src} alt="" aria-hidden className={cn("shrink-0 rounded-full object-cover", sizes[size], className)} />;
  }
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-medium", sizes[size], avatarColor(name), className)}
    >
      {initials(name)}
    </span>
  );
}

export function AvatarStack({ names, max = 4 }: { names: string[]; max?: number }) {
  return (
    <div className="flex -space-x-2">
      {names.slice(0, max).map((n, i) => (
        <Avatar key={`${n}-${i}`} name={n} size="sm" className="ring-2 ring-card" />
      ))}
      {names.length > max && (
        <span className="inline-flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium ring-2 ring-card">
          +{names.length - max}
        </span>
      )}
    </div>
  );
}

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("animate-pulse rounded-sm bg-muted", className)} {...props} />;
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg bg-stone px-6 py-14 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-card text-foreground [&_svg]:size-5">{icon}</div>
      <h3 className="text-2xl">{title}</h3>
      {children && <p className="max-w-sm text-sm text-muted-foreground">{children}</p>}
      {action}
    </div>
  );
}
