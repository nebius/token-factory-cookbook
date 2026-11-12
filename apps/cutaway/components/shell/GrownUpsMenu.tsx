"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { Activity, Code, Ellipsis } from "lucide-react";
import Link from "next/link";
import styles from "./shell.module.css";

/** Technical bits most learners never need: the model status and the call log. */
export function GrownUpsMenu({ status, ok }: { status: string; ok: boolean }) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button className="btn btn-ghost btn-sm btn-icon" aria-label="More">
          <Ellipsis size={18} />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="menu" align="end" sideOffset={8}>
          <div className="menu-label">For grown-ups</div>
          <div className={styles.status}>
            <span className={styles.dot} data-ok={ok} />
            {status}
          </div>
          <Menu.Item asChild className="menu-item">
            <Link href="/runs">
              <Activity size={16} /> Model call log and cost
            </Link>
          </Menu.Item>
          <Menu.Item asChild className="menu-item">
            <a href="https://github.com/Studio1-OSS" target="_blank" rel="noreferrer">
              <Code size={16} /> Source code
            </a>
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
