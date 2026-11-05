import { TopNav } from "@/components/shell/TopNav";
import styles from "@/components/shell/shell.module.css";

export const dynamic = "force-dynamic";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TopNav />
      <main className={`${styles.main} paper`}>{children}</main>
    </>
  );
}
