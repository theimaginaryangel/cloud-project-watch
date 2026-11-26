import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/scans/orchestrator";
import { enforceApiGuard, toErrorResponse } from "@/lib/security/guards";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const blocked = await enforceApiGuard(request);
  if (blocked) return blocked;

  try {
    const data = await getDashboardData(true);
    return NextResponse.json(data);
  } catch (err) {
    return toErrorResponse(err, "Failed to load dashboard.");
  }
}
