import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export function Sheet({ open, onOpenChange, title, subtitle, children, className }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: React.ReactNode; subtitle?: React.ReactNode;
  children: React.ReactNode; className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px]" />
        <Dialog.Content
          className={cn("fixed right-0 top-0 z-50 flex h-full w-[min(720px,100vw)] flex-col border-l border-line bg-panel shadow-2xl animate-fade-in", className)}>
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-sm font-semibold">{title}</Dialog.Title>
              {subtitle && <Dialog.Description className="mt-0.5 text-xs text-muted">{subtitle}</Dialog.Description>}
            </div>
            <Dialog.Close className="rounded-md p-1 text-muted hover:bg-raised hover:text-ink" aria-label="Close"><X className="size-4" /></Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
