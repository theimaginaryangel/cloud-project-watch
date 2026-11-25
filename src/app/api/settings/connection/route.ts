import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { awsConnections, ensureDbReady } from "@/db";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/crypto";
import {
  getOrCreatePrimaryConnection,
  type StoredAwsCredsPayload,
} from "@/lib/scans/orchestrator";
import {
  blockIfPublicDemoLocked,
  isPublicDemoLocked,
} from "@/lib/security/guards";

const UpdateConnectionSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  mode: z.enum(["demo", "iam_keys", "env_default"]),
  regions: z.array(z.string().min(4).max(32)).min(1).max(16),
  costExplorerEnabled: z.boolean(),
  accessKeyId: z.string().trim().optional(),
  secretAccessKey: z.string().trim().optional(),
});

export async function GET() {
  try {
    const conn = await getOrCreatePrimaryConnection();
    let maskedAccessKey = { configured: false, last4: null as string | null };

    if (conn.encryptedCredentials) {
      try {
        const parsed = JSON.parse(
          decryptSecret(conn.encryptedCredentials),
        ) as StoredAwsCredsPayload;
        maskedAccessKey = maskSecret(parsed.accessKeyId);
      } catch {
        maskedAccessKey = { configured: false, last4: null };
      }
    }

    return NextResponse.json({
      connection: {
        id: conn.id,
        name: conn.name,
        mode: conn.mode,
        regions: conn.regions,
        costExplorerEnabled: conn.costExplorerEnabled,
        credentials: maskedAccessKey,
        envAwsAvailable: Boolean(
          process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY,
        ),
        publicDemoLocked: isPublicDemoLocked(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load AWS settings.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const locked = blockIfPublicDemoLocked();
  if (locked) return locked;

  try {
    const body: unknown = await request.json();
    const parsed = UpdateConnectionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid AWS connection settings." },
        { status: 400 },
      );
    }

    const db = await ensureDbReady();
    const conn = await getOrCreatePrimaryConnection();

    let encryptedCredentials = conn.encryptedCredentials;
    if (parsed.data.mode === "iam_keys") {
      if (parsed.data.accessKeyId && parsed.data.secretAccessKey) {
        encryptedCredentials = encryptSecret(
          JSON.stringify({
            accessKeyId: parsed.data.accessKeyId,
            secretAccessKey: parsed.data.secretAccessKey,
          } satisfies StoredAwsCredsPayload),
        );
      } else if (!encryptedCredentials) {
        return NextResponse.json(
          { error: "Enter both AWS Access Key ID and Secret Access Key for IAM Key mode." },
          { status: 400 },
        );
      }
    }

    const [updated] = await db
      .update(awsConnections)
      .set({
        name: parsed.data.name ?? conn.name,
        mode: parsed.data.mode,
        regions: [...new Set(parsed.data.regions)],
        costExplorerEnabled: parsed.data.costExplorerEnabled,
        encryptedCredentials,
        updatedAt: new Date(),
      })
      .where(eq(awsConnections.id, conn.id))
      .returning();

    return NextResponse.json({
      ok: true,
      connection: {
        id: updated?.id ?? conn.id,
        name: updated?.name ?? conn.name,
        mode: updated?.mode ?? parsed.data.mode,
        regions: updated?.regions ?? parsed.data.regions,
        costExplorerEnabled: updated?.costExplorerEnabled ?? parsed.data.costExplorerEnabled,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update AWS settings.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
