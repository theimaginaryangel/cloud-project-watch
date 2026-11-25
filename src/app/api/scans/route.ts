import { NextResponse } from "next/server";
import { z } from "zod";
import { ScanConflictError, triggerScan } from "@/lib/scans/orchestrator";

const TriggerScanSchema = z.object({
  idempotencyKey: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const parsed = TriggerScanSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "A valid idempotencyKey (8-128 chars) is required." },
        { status: 400 },
      );
    }

    const result = await triggerScan({
      idempotencyKey: parsed.data.idempotencyKey,
    });

    return NextResponse.json(result, { status: result.deduplicated ? 200 : 201 });
  } catch (err) {
    if (err instanceof ScanConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "Scan failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
