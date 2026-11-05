// A paper receipt for one model call: fresh and cached input, output (reasoning included), total, and what
// cached input saved. The total is what the call was billed; the lines use today's per-token prices.
import { savedBy } from "@/lib/cache";
import { formatUsd, seconds } from "@/lib/format";
import type { CallRecord, Price } from "@/lib/schemas";

export function Receipt({ call, price, title, model }: { call: CallRecord; price: Price | null; title: string; model: string }) {
  const cached = Math.min(call.usage.cached, call.usage.input);
  const fresh = call.usage.input - cached;
  const saved = call.saved ?? savedBy(call.usage, price);
  const line = (label: string, tokens: number, perToken: number | undefined) => (
    <p className="flex justify-between gap-3">
      <span>
        {label} · {tokens.toLocaleString()}
      </span>
      <span>{perToken === undefined ? "—" : formatUsd(tokens * perToken)}</span>
    </p>
  );
  return (
    <figure className="m-0 rounded-[4px] bg-paper px-5 pt-5 pb-4 font-mono text-[12px] leading-relaxed text-paper-ink shadow-[0_1px_0_rgba(0,0,0,0.08),0_18px_40px_-24px_rgba(0,0,0,0.5)]">
      <figcaption className="flex justify-between text-[10.5px] tracking-[0.15em] text-[#7a7262] uppercase">
        <span>Receipt</span>
        <span>{new Date(call.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
      </figcaption>
      <p className="mt-2 mb-3 font-display text-[15px] leading-snug font-medium text-paper-ink [font-stretch:85%]">{title}</p>
      {line("Fresh input", fresh, price?.input)}
      {line("Cached input", cached, price?.cached)}
      {line("Output", call.usage.output, price?.output)}
      <p className="mt-2.5 flex justify-between border-t border-dashed border-[#b9ae94] pt-2.5 text-[14px] font-semibold">
        <span>Total</span>
        <span>{formatUsd(call.cost)}</span>
      </p>
      <p className="mt-1 flex justify-between text-[#1f6b3d]">
        <span>Saved by cached input</span>
        <span>{formatUsd(saved ?? 0)}</span>
      </p>
      {price && call.cost !== null && Math.abs(fresh * price.input + cached * price.cached + call.usage.output * price.output - call.cost) > Math.max(0.0001, call.cost * 0.01) && (
        <p className="mt-1 text-[10.5px] text-[#7a7262]">Lines at today&apos;s prices; the total is what this call was billed.</p>
      )}
      <p className="mt-2.5 text-[10.5px] text-[#7a7262]">
        {model} · {seconds(call.ms)}
        {call.attempts > 1 ? ` · ${call.attempts} attempts` : ""} · {Math.round((cached / Math.max(1, call.usage.input)) * 100)}% of input from cache
      </p>
    </figure>
  );
}
