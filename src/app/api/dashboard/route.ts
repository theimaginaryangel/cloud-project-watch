import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/scans/orchestrator";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getDashboardData(true);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load dashboard.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
