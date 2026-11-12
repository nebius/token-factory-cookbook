"use client";

// The visitor's "reduce motion" setting, for animations CSS can't switch off (SVG animateMotion).
import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";
const subscribe = (on: () => void) => {
  const m = window.matchMedia(QUERY);
  m.addEventListener("change", on);
  return () => m.removeEventListener("change", on);
};

export const useReducedMotion = () =>
  useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
