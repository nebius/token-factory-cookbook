"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import { Toaster } from "sonner";
import { BuildWatcher } from "./BuildWatcher";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={250} skipDelayDuration={150}>
      {children}
      <BuildWatcher />
      <Toaster
        position="bottom-center"
        toastOptions={{
          style: { fontFamily: "var(--font-sans)", fontSize: 14.5, borderRadius: 16, background: "var(--panel)", color: "var(--ink)", border: "1px solid var(--line)", boxShadow: "var(--shadow-2)" },
          actionButtonStyle: { background: "var(--stone)", color: "var(--bg)", borderRadius: 999, padding: "0 14px" },
        }}
      />
    </Tooltip.Provider>
  );
}
