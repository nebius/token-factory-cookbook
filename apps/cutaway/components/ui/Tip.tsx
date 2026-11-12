"use client";

import * as Tooltip from "@radix-ui/react-tooltip";

/** A friendly tooltip: a bold title and a plain-words explanation. */
export function Tip({ title, text, children, side = "top" }: { title?: string; text: string; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tip" side={side} sideOffset={8} collisionPadding={12}>
          {title && <b>{title}</b>}
          {text}
          <Tooltip.Arrow className="tip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
