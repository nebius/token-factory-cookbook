import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

// the design system: near-black pill for the one primary action, outline pill for light controls,
// underlined text link for the companion action. No shadows.
const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors active:opacity-80 disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Primary: the frosted pill (same colour as before, top highlight, inner depth, soft glow).
        default:
          "rounded-pill border border-white/40 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--primary)_96%,white),color-mix(in_srgb,var(--primary)_82%,transparent))] text-primary-foreground backdrop-blur-xl shadow-[inset_0_1px_0_rgb(255_255_255/0.75),inset_0_-10px_18px_-10px_rgb(0_0_0/0.2),0_10px_28px_-10px_color-mix(in_srgb,var(--primary)_40%,transparent)] hover:brightness-105",
        // Clear glass for light controls.
        outline:
          "rounded-pill border border-glass-border bg-glass-fill shadow-[inset_0_1px_0_var(--glass-shine),0_6px_18px_-10px_rgb(0_0_0/0.4)] backdrop-blur-md hover:border-foreground/30 hover:bg-muted",
        secondary:
          "rounded-pill border border-glass-border bg-stone text-foreground shadow-[inset_0_1px_0_var(--glass-shine)] backdrop-blur-md hover:bg-muted",
        ghost: "rounded-pill hover:bg-muted",
        // The primary pill as glass: same colour, a bright top edge, inner depth and a soft glow.
        glass:
          "rounded-pill border border-white/60 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--primary)_97%,white),color-mix(in_srgb,var(--primary)_80%,transparent))] text-primary-foreground backdrop-blur-xl shadow-[inset_0_1px_0_rgb(255_255_255/0.9),inset_0_-10px_18px_-10px_rgb(0_0_0/0.22),0_10px_30px_-8px_color-mix(in_srgb,var(--primary)_35%,transparent)] hover:brightness-105 hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.9),inset_0_-10px_18px_-10px_rgb(0_0_0/0.22),0_12px_36px_-6px_color-mix(in_srgb,var(--primary)_45%,transparent)]",
        inverse: "rounded-pill bg-white text-[#17171c] hover:bg-white/85",
        destructive: "rounded-pill bg-negative text-white hover:bg-negative/90",
        link: "rounded-xs px-0 underline underline-offset-4 decoration-1 hover:decoration-2",
      },
      size: {
        sm: "h-9 px-4 text-sm max-md:h-11",
        default: "h-11 px-6 text-sm",
        lg: "h-12 px-7 text-[15px]",
        icon: "size-11",
        "icon-sm": "size-9 max-md:size-11",
      },
    },
    compoundVariants: [{ variant: "link", className: "h-auto px-0" }],
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean; loading?: boolean };

export function Button({ className, variant, size, asChild, loading, children, disabled, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }), loading && "[&>svg:not(.animate-spin)]:hidden")}
      disabled={disabled || loading}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading && <Loader2 className="animate-spin" />}
          {children}
        </>
      )}
    </Comp>
  );
}

export { buttonVariants };
