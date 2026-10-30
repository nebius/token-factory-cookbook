"use client";

import * as React from "react";
import { currencyExponent, formatMoney, minorToInput, parseMoneyInput, sanitizeMoneyText, type Minor } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Shows an amount coloured by sign: positive = owed to you, negative = you owe. */
export function Amount({
  value,
  currency,
  signed,
  className,
}: {
  value: Minor;
  currency: string;
  signed?: boolean;
  className?: string;
}) {
  const tone = !signed || value === 0 ? "" : value > 0 ? "text-positive" : "text-negative";
  return (
    <span className={cn("tabular", tone, className)}>
      {signed && value > 0 ? "+" : ""}
      {formatMoney(value, currency)}
    </span>
  );
}

/** Text input for money that keeps what the user typed and reports integer minor units. */
export function MoneyInput({
  value,
  onChange,
  currency,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "value" | "onChange"> & {
  value: Minor;
  onChange: (value: Minor) => void;
  currency: string;
}) {
  const [text, setText] = React.useState(() => (value ? minorToInput(value, currency) : ""));
  const lastEmitted = React.useRef(value);

  // Sync when the value changes from outside (e.g. after a scan or a currency switch).
  React.useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value;
      setText(value ? minorToInput(value, currency) : "");
    }
  }, [value, currency]);

  return (
    <input
      inputMode={currencyExponent(currency) > 0 ? "decimal" : "numeric"}
      autoComplete="off"
      placeholder={minorToInput(0, currency)}
      className={cn(
        "tabular h-12 w-full min-w-0 rounded-xs border border-input bg-card px-3 text-right text-base outline-none transition placeholder:text-subtle focus-visible:border-[#9b60aa] focus-visible:ring-2 focus-visible:ring-[#9b60aa]/20 md:h-11 md:text-sm",
        className,
      )}
      value={text}
      onChange={(e) => {
        // Numbers only: letters and symbols are dropped as you type.
        const clean = sanitizeMoneyText(e.target.value, currency);
        setText(clean);
        const parsed = parseMoneyInput(clean, currency);
        const next = parsed === null ? 0 : Math.max(0, parsed);
        lastEmitted.current = next;
        onChange(next);
      }}
      onBlur={() => setText(value ? minorToInput(value, currency) : "")}
      onPaste={(e) => {
        // Pasted "₹1,20,400.50", "1.234,56" or "$12" become plain numbers (same rules as typing).
        const pasted = e.clipboardData.getData("text");
        e.preventDefault();
        const clean = sanitizeMoneyText(pasted, currency);
        setText(clean);
        const parsed = parseMoneyInput(clean, currency);
        const next = parsed === null ? 0 : Math.max(0, parsed);
        lastEmitted.current = next;
        onChange(next);
      }}
      {...props}
    />
  );
}
