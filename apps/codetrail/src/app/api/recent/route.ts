import { NextResponse } from "next/server";
import { getRecent } from "@/server/trail/service";

export async function GET() {
  return NextResponse.json({ recent: await getRecent() });
}
