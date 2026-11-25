import { NextResponse } from "next/server";
import { syncCostExplorerGuarded } from "@/lib/aws/cost-explorer";
import {
  getOrCreatePrimaryConnection,
  resolveAwsCredentialsFromConnection,
} from "@/lib/scans/orchestrator";
import { blockIfPublicDemoLocked } from "@/lib/security/guards";

export async function POST() {
  const locked = blockIfPublicDemoLocked();
  if (locked) return locked;

  try {
    const conn = await getOrCreatePrimaryConnection();
    if (conn.mode === "demo") {
      return NextResponse.json(
        {
          error:
            "Cost Explorer sync is only available in Live AWS mode. Demo Mode already computes instant $0 estimates.",
        },
        { status: 400 },
      );
    }

    const credentials = resolveAwsCredentialsFromConnection(conn);
    const result = await syncCostExplorerGuarded({
      connectionId: conn.id,
      credentials,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cost Explorer sync failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
