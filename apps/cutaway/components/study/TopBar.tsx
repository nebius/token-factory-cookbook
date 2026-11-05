"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as Menu from "@radix-ui/react-dropdown-menu";
import * as Switch from "@radix-ui/react-switch";
import { Bookmark, ChevronLeft, CircleQuestionMark, Ellipsis, FileDown, Image as ImageIcon, Printer, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type RefObject } from "react";
import { toast } from "sonner";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { Tip } from "@/components/ui/Tip";
import { api, timeAgo } from "@/lib/client/api";
import { isTestData } from "@/lib/provenance";
import type { Diagram, Meta } from "@/lib/schema/teardown";
import type { TeardownEngine } from "@/lib/viewer/engine";
import type { TeardownInfo } from "./StudyView";
import { startTour } from "./tour";
import styles from "./study.module.css";

type Props = {
  teardown: TeardownInfo;
  meta: Meta;
  versions: { id: number; version: number; created_at: string; provider: string | null }[];
  expert: boolean;
  onExpert: (on: boolean) => void;
  bookmarked: boolean;
  onBookmark: () => void;
  fromLibrary: boolean;
  diagrams: Diagram[];
  engine: RefObject<TeardownEngine | null>;
};

function download(href: string, name: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.click();
}

export function TopBar(p: Props) {
  const router = useRouter();
  const [regen, setRegen] = useState(false);
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const fileBase = p.meta.device.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const nextVersion = Math.max(p.teardown.version, ...p.versions.map((v) => v.version)) + 1;

  useEffect(() => {
    if (p.fromLibrary) toast("Opened from your machines. No waiting needed!");
  }, [p.fromLibrary]);

  const regenerate = async () => {
    setBusy(true);
    try {
      const r = await api<{ id: number }>(`/api/teardowns/${p.teardown.id}/regenerate`, { body: { hint: hint || undefined } });
      router.push(`/new?id=${r.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <header className={`${styles.top} no-print`}>
      <Link href="/library" className={styles.back} aria-label="Back to machines">
        <ChevronLeft size={17} /> <span className={styles.hideSm}>Machines</span>
      </Link>
      <div className={styles.title}>
        <h1>{p.meta.device.name}</h1>
        <div className={styles.sub}>
          {p.meta.device.summary}
          {isTestData(p.teardown.provider) && (
            <Tip text="Hand-made sample data used for testing the app, not made by Kimi.">
              <span className={styles.sample}> · sample</span>
            </Tip>
          )}
        </div>
      </div>

      <div className={styles.topRight}>
        <Tip title="Expert details" text="Show the science and engineering too: numbers, equations, how parts fail.">
          <label className={styles.expert}>
            <span className={styles.hideSm}>Expert details</span>
            <Switch.Root className="switch" checked={p.expert} onCheckedChange={p.onExpert} aria-label="Expert details">
              <Switch.Thumb className="switch-thumb" />
            </Switch.Root>
          </label>
        </Tip>
        <button className="btn btn-sm" onClick={p.onBookmark} aria-pressed={p.bookmarked}>
          <Bookmark size={15} fill={p.bookmarked ? "currentColor" : "none"} />
          <span className={styles.hideSm}>{p.bookmarked ? "Saved" : "Save"}</span>
        </button>
        <Menu.Root>
          <Menu.Trigger asChild>
            <button className="btn btn-sm btn-icon" aria-label="More">
              <Ellipsis size={18} />
            </button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content className="menu" align="end" sideOffset={8}>
              <Menu.Item className="menu-item" onSelect={() => window.open(`/t/${p.teardown.slug}/print?v=${p.teardown.version}`, "_blank")}>
                <Printer size={16} /> Print a study sheet
              </Menu.Item>
              <Menu.Item
                className="menu-item"
                onSelect={() => {
                  const url = p.engine.current?.capture();
                  if (url) download(url, `${fileBase}-3d.png`);
                }}
              >
                <ImageIcon size={16} /> Save a picture of the 3D view
              </Menu.Item>
              <Menu.Item
                className="menu-item"
                disabled={!p.diagrams.length}
                onSelect={() => {
                  for (const d of p.diagrams) download(URL.createObjectURL(new Blob([d.svg], { type: "image/svg+xml" })), `${fileBase}-${d.kind}.svg`);
                }}
              >
                <FileDown size={16} /> Download the drawings
              </Menu.Item>
              <Menu.Item className="menu-item" onSelect={() => startTour()}>
                <CircleQuestionMark size={16} /> Show me how this works
              </Menu.Item>
              <Menu.Separator className="menu-sep" />
              <Menu.Label className="menu-label">Version</Menu.Label>
              {p.versions.map((v) => (
                <Menu.Item key={v.id} className="menu-item" onSelect={() => router.push(`/t/${p.teardown.slug}?v=${v.version}`)}>
                  <span style={{ width: 16, textAlign: "center" }}>{v.version === p.teardown.version ? "✓" : ""}</span>
                  Version {v.version} · {timeAgo(v.created_at)}
                </Menu.Item>
              ))}
              <Menu.Item className="menu-item" onSelect={() => setRegen(true)}>
                <RefreshCw size={16} /> Ask Kimi for a new version
              </Menu.Item>
              <Menu.Separator className="menu-sep" />
              <div style={{ padding: "4px 6px" }}>
                <ThemeToggle />
              </div>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      </div>

      <Dialog.Root open={regen} onOpenChange={(o) => !busy && setRegen(o)}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog">
            <Dialog.Title>Make a new version?</Dialog.Title>
            <Dialog.Description asChild>
              <p>
                Kimi K3.1 Pro will design this machine again as version {nextVersion}. It takes about half an hour and a few model calls, and keeps going if you leave. This version, your notes and your progress stay.
              </p>
            </Dialog.Description>
            <label style={{ fontWeight: 800, fontSize: 14, display: "block", marginBottom: 6 }} htmlFor="regen-hint">
              What should be different? (optional)
            </label>
            <input id="regen-hint" className="input" value={hint} onChange={(e) => setHint(e.target.value)} placeholder="e.g. more detail inside the motor" />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
              <Dialog.Close asChild>
                <button className="btn" disabled={busy}>
                  Not now
                </button>
              </Dialog.Close>
              <button className="btn btn-primary" onClick={regenerate} disabled={busy}>
                <RefreshCw size={16} className={busy ? "spin" : ""} /> Make version {nextVersion}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </header>
  );
}
