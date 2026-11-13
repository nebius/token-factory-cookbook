import { notFound } from "next/navigation";
import { RunView } from "@/components/RunView";
import { loadRun } from "@/lib/runs";

export const dynamic = "force-dynamic";

export default async function RunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ cell?: string }> }) {
  const { id } = await params;
  const { cell } = await searchParams;
  const run = /^[a-z0-9-]+$/.test(id) ? await loadRun(id) : null;
  if (!run) notFound();
  return <RunView initial={run} initialCell={typeof cell === "string" ? cell.slice(0, 80) : undefined} />;
}
