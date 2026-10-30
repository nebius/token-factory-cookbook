import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export function Switch({ checked, onCheckedChange, label, id }: { checked: boolean; onCheckedChange: (v: boolean) => void; label: string; id: string }) {
  return (
    <label htmlFor={id} className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted">
      <SwitchPrimitive.Root id={id} checked={checked} onCheckedChange={onCheckedChange}
        className={cn("relative h-5 w-9 rounded-full border border-line bg-raised transition-colors data-[state=checked]:bg-accent/80")}>
        <SwitchPrimitive.Thumb className="block size-4 translate-x-0.5 rounded-full bg-ink transition-transform data-[state=checked]:translate-x-[18px]" />
      </SwitchPrimitive.Root>
      {label}
    </label>
  );
}
