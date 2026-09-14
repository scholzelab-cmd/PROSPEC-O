import { NextResponse } from "next/server";
import { getDatabase } from "@/db/client";
import { getSystemStatus } from "@/lib/system-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  const status = getSystemStatus(getDatabase().sqlite);

  return NextResponse.json({
    status: status.paused ? "paused" : "running",
    reason: status.reason,
    checkedAt: new Date().toISOString()
  });
}
