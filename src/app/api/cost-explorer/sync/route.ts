import { NextResponse } from "next/server";
import { syncCostExplorerGuarded } from "@/lib/aws/cost-explorer";
import {
  getOrCreatePrimaryConnection,
  resolveAwsCredentialsFromConnection,
} from "@/lib/scans/orchestrator";
import {
  AppError,
  enforceApiGuard,
  toErrorResponse,
} from "@/lib/security/guards";

export async function POST(request: Request) {
  const blocked = await enforceApiGuard(request, {
    mutation: true,
    blockDemo: true,
    rateLimit: { bucket: "cost_explorer", limit: 6, windowMs: 60_000 },
  });
  if (blocked) return blocked;

  try {
    const conn = await getOrCreatePrimaryConnection();
    if (conn.mode === "demo") {
      throw new AppError(
        "Cost Explorer sync is only available in Live AWS mode. Demo Mode already computes instant $0 estimates.",
        400,
      );
    }

    const credentials = resolveAwsCredentialsFromConnection(conn);
    const result = await syncCostExplorerGuarded({
      connectionId: conn.id,
      credentials,
    });

    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err, "Cost Explorer sync failed.");
  }
}
