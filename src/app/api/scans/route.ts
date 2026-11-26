import { NextResponse } from "next/server";
import { z } from "zod";
import { triggerScan } from "@/lib/scans/orchestrator";
import {
  blockIfPublicDemoLocked,
  enforceApiGuard,
  isStatelessDemoMode,
  parseJsonBody,
  toErrorResponse,
} from "@/lib/security/guards";

const TriggerScanSchema = z.object({
  idempotencyKey: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  const blocked = await enforceApiGuard(request, {
    mutation: true,
    rateLimit: { bucket: "scans", limit: 15, windowMs: 60_000 },
  });
  if (blocked) return blocked;

  if (!isStatelessDemoMode()) {
    const demoLocked = blockIfPublicDemoLocked();
    if (demoLocked) return demoLocked;
  }

  try {
    const parsed = await parseJsonBody(request, TriggerScanSchema, {
      invalidMessage: "A valid idempotencyKey (8-128 chars) is required.",
    });

    const result = await triggerScan({
      idempotencyKey: parsed.idempotencyKey,
    });

    return NextResponse.json(result, { status: result.deduplicated ? 200 : 201 });
  } catch (err) {
    return toErrorResponse(err, "Scan failed.");
  }
}
