import { recentJobs } from "@/lib/jobs/runner";
import { json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Jobs running (or just finished) on this server, for the "building" indicator on every page. */
export async function GET() {
  return json({ jobs: recentJobs() });
}
