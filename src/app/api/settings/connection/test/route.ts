import { NextResponse } from "next/server";
import { z } from "zod";
import { testAwsCredentials } from "@/lib/aws/scanner";
import {
  getOrCreatePrimaryConnection,
  resolveAwsCredentialsFromConnection,
} from "@/lib/scans/orchestrator";
import {
  assertAmbientAwsAllowed,
  blockIfPublicDemoLocked,
  enforceApiGuard,
  isStatelessDemoMode,
  parseJsonBody,
  sanitizeErrorMessage,
} from "@/lib/security/guards";

const AWS_REGION_PATTERN = /^[a-z]{2}(?:-[a-z]+)+-\d+$/;

const TestConnectionSchema = z.object({
  mode: z.enum(["demo", "iam_keys", "env_default"]).optional(),
  region: z.string().trim().regex(AWS_REGION_PATTERN).optional(),
  accessKeyId: z.string().trim().max(128).optional(),
  secretAccessKey: z.string().trim().max(256).optional(),
});

export async function POST(request: Request) {
  const blocked = await enforceApiGuard(request, {
    mutation: true,
    rateLimit: { bucket: "test_aws", limit: 10, windowMs: 60_000 },
  });
  if (blocked) return blocked;

  try {
    const parsed = await parseJsonBody(request, TestConnectionSchema, {
      invalidMessage: "Invalid test payload.",
    });

    if (isStatelessDemoMode()) {
      if ((parsed.mode ?? "demo") === "demo") {
        return NextResponse.json({
          ok: true,
          accountId: "123456789012",
          arn: "arn:aws:iam::123456789012:user/cloudprojectwatch-demo",
          message: "Demo mode active — zero AWS credentials required.",
        });
      }
      const locked = blockIfPublicDemoLocked();
      if (locked) return locked;
    }

    const conn = await getOrCreatePrimaryConnection();
    const mode = parsed.mode ?? conn.mode;
    const region = parsed.region ?? conn.regions[0] ?? "us-east-1";

    if (mode === "demo") {
      return NextResponse.json({
        ok: true,
        accountId: "123456789012",
        arn: "arn:aws:iam::123456789012:user/cloudprojectwatch-demo",
        message: "Demo Mode active — zero AWS credentials required.",
      });
    }

    const locked = blockIfPublicDemoLocked();
    if (locked) return locked;

    if (mode === "env_default") {
      assertAmbientAwsAllowed();
    }

    const credentials =
      mode === "iam_keys" && parsed.accessKeyId && parsed.secretAccessKey
        ? {
            accessKeyId: parsed.accessKeyId,
            secretAccessKey: parsed.secretAccessKey,
          }
        : resolveAwsCredentialsFromConnection({ ...conn, mode });

    const identity = await testAwsCredentials(region, credentials);
    return NextResponse.json({
      ok: true,
      accountId: identity.accountId,
      arn: identity.arn,
      message: `Connected to AWS Account ${identity.accountId} (${identity.arn}).`,
    });
  } catch (err) {
    const { message, status } = sanitizeErrorMessage(err, "AWS connection test failed.");
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
