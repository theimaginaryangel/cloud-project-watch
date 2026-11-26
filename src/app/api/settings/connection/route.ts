import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { awsConnections, ensureDbReady } from "@/db";
import { encryptSecret, maskSecret, tryDecryptSecret } from "@/lib/crypto";
import {
  getOrCreatePrimaryConnection,
  type StoredAwsCredsPayload,
} from "@/lib/scans/orchestrator";
import {
  AppError,
  assertAmbientAwsAllowed,
  enforceApiGuard,
  isAmbientAwsAllowed,
  isPublicDemoLocked,
  isStatelessDemoMode,
  parseJsonBody,
  toErrorResponse,
} from "@/lib/security/guards";

const AWS_REGION_PATTERN = /^[a-z]{2}(?:-[a-z]+)+-\d+$/;

const UpdateConnectionSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  mode: z.enum(["demo", "iam_keys", "env_default"]),
  regions: z
    .array(z.string().trim().regex(AWS_REGION_PATTERN, "Invalid AWS region format."))
    .min(1)
    .max(16),
  costExplorerEnabled: z.boolean(),
  accessKeyId: z.string().trim().max(128).optional(),
  secretAccessKey: z.string().trim().max(256).optional(),
  clearCredentials: z.boolean().optional(),
});

export async function GET(request: Request) {
  const blocked = await enforceApiGuard(request);
  if (blocked) return blocked;

  if (isStatelessDemoMode()) {
    return NextResponse.json({
      connection: {
        id: "stateless-demo",
        name: "Demo AWS",
        mode: "demo",
        regions: ["us-east-1", "us-east-2"],
        costExplorerEnabled: false,
        credentials: { configured: false, last4: null },
        envAwsAvailable: false,
        ambientAwsAllowed: false,
        publicDemoLocked: true,
      },
    });
  }

  try {
    const conn = await getOrCreatePrimaryConnection();
    let maskedAccessKey = { configured: false, last4: null as string | null };

    const decrypted = tryDecryptSecret(conn.encryptedCredentials);
    if (decrypted) {
      try {
        const parsed = JSON.parse(decrypted) as StoredAwsCredsPayload;
        maskedAccessKey = maskSecret(parsed.accessKeyId);
      } catch {
        maskedAccessKey = { configured: false, last4: null };
      }
    }

    const ambientAllowed = isAmbientAwsAllowed();

    return NextResponse.json({
      connection: {
        id: conn.id,
        name: conn.name,
        mode: conn.mode,
        regions: conn.regions,
        costExplorerEnabled: conn.costExplorerEnabled,
        credentials: maskedAccessKey,
        envAwsAvailable:
          ambientAllowed &&
          Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY),
        ambientAwsAllowed: ambientAllowed,
        publicDemoLocked: isPublicDemoLocked(),
      },
    });
  } catch (err) {
    return toErrorResponse(err, "Failed to load AWS settings.");
  }
}

export async function POST(request: Request) {
  const blocked = await enforceApiGuard(request, {
    mutation: true,
    blockDemo: true,
    rateLimit: { bucket: "settings_conn", limit: 20, windowMs: 60_000 },
  });
  if (blocked) return blocked;

  try {
    const parsed = await parseJsonBody(request, UpdateConnectionSchema, {
      invalidMessage: "Invalid AWS connection settings.",
    });

    if (parsed.mode === "env_default") {
      assertAmbientAwsAllowed();
    }

    const db = await ensureDbReady();
    const conn = await getOrCreatePrimaryConnection();

    let encryptedCredentials = parsed.clearCredentials ? null : conn.encryptedCredentials;

    if (parsed.mode === "iam_keys") {
      if (parsed.accessKeyId && parsed.secretAccessKey) {
        encryptedCredentials = encryptSecret(
          JSON.stringify({
            accessKeyId: parsed.accessKeyId,
            secretAccessKey: parsed.secretAccessKey,
          } satisfies StoredAwsCredsPayload),
        );
      } else if (!encryptedCredentials || !tryDecryptSecret(encryptedCredentials)) {
        throw new AppError(
          "Enter both AWS Access Key ID and Secret Access Key for IAM Key mode.",
          400,
        );
      }
    }

    const [updated] = await db
      .update(awsConnections)
      .set({
        name: parsed.name ?? conn.name,
        mode: parsed.mode,
        regions: [...new Set(parsed.regions)],
        costExplorerEnabled: parsed.costExplorerEnabled,
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
        mode: updated?.mode ?? parsed.mode,
        regions: updated?.regions ?? parsed.regions,
        costExplorerEnabled: updated?.costExplorerEnabled ?? parsed.costExplorerEnabled,
      },
    });
  } catch (err) {
    return toErrorResponse(err, "Failed to update AWS settings.");
  }
}
