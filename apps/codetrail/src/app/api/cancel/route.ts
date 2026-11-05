// Stop: the client cancels one of its own runs by the random id it sent with the request.
import { NextResponse } from "next/server";
import { z } from "zod";
import { cancelRun } from "@/server/cancel";
import { errorResponse } from "@/server/http";

export async function POST(req: Request) {
  try {
    const { runId } = z.object({ runId: z.string().regex(/^[\w-]{8,64}$/) }).parse(await req.json());
    return NextResponse.json({ stopped: cancelRun(runId) });
  } catch (error) {
    return errorResponse(error);
  }
}
