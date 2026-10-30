"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/**
 * Bottom sheet on phones, centred 8px-radius panel on larger screens.
 * `glass` swaps the flat card for a frosted panel over a blurred page.
 */
export function DialogContent({
  className,
  children,
  title,
  description,
  glass,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { title: string; description?: string; glass?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          "fixed inset-0 z-50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
          glass ? "bg-black/25 backdrop-blur-[6px]" : "bg-black/50",
        )}
      />
      <DialogPrimitive.Content
        className={cn(
          "no-scrollbar fixed inset-x-0 bottom-0 z-50 grid max-h-[92dvh] gap-5 overflow-y-auto overscroll-contain rounded-t-lg p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-8 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:pb-6 sm:data-[state=open]:slide-in-from-bottom-2",
          glass
            ? "glass isolate sm:rounded-lg sm:data-[state=open]:zoom-in-95"
            : "border-t bg-card sm:rounded-sm sm:border",
          className,
        )}
        {...props}
      >
        <div aria-hidden className="mx-auto -mt-2 h-1 w-10 rounded-full bg-hairline sm:hidden" />
        <div className="grid gap-1 pr-8">
          <DialogPrimitive.Title className="font-display text-2xl">{title}</DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="text-sm text-muted-foreground">{description}</DialogPrimitive.Description>
          ) : (
            <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
          )}
        </div>
        {children}
        <DialogPrimitive.Close className="absolute right-3 top-3 flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
          <X className="size-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
