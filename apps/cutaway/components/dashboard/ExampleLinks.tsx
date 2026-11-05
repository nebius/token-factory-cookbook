"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { startFromText } from "./StartCard";
import styles from "./dashboard.module.css";

const EXAMPLES: [string, string][] = [
  ["Drone motor", "Brushless drone motor"],
  ["Smartphone", "Smartphone"],
  ["Jet engine", "Turbofan jet engine"],
  ["Hard drive", "Hard disk drive"],
  ["Bike gears", "Bicycle rear derailleur"],
  ["Washing machine", "Front-loading washing machine"],
];

export function ExampleLinks() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const open = async (ask: string) => {
    setBusy(ask);
    try {
      await startFromText(ask, router);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };
  return (
    <div className={styles.examples}>
      <span className="eyebrow">Or try one</span>
      <div className={styles.exampleRow}>
        {EXAMPLES.map(([label, ask]) => (
          <button key={ask} className={styles.exampleLink} onClick={() => open(ask)} disabled={!!busy}>
            {busy === ask ? "Starting…" : label}
          </button>
        ))}
      </div>
    </div>
  );
}
