import { NextResponse } from "next/server";
import { z } from "zod";
import { testAwsCredentials } from "@/lib/aws/scanner";
import {
  getOrCreatePrimaryConnection,
  resolveAwsCredentialsFromConnection,
} from "@/lib/scans/orchestrator";

const TestConnectionSchema = z.object({
  mode: z.enum(["demo", "iam_keys", "env_default"]).optional(),
  region: z.string().min(4).max(32).optional(),
  accessKeyId: z.string().trim().optional(),
  secretAccessKey: z.string().trim().optional(),
});

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const parsed = TestConnectionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid test payload." }, { status: 400 });
    }

    const conn = await getOrCreatePrimaryConnection();
    const mode = parsed.data.mode ?? conn.mode;
    const region = parsed.data.region ?? conn.regions[0] ?? "us-east-1";

    if (mode === "demo") {
      return NextResponse.json({
        ok: true,
        accountId: "123456789012",
        arn: "arn:aws:iam::123456789012:user/tagwatch-demo",
        message: "Demo Mode active — zero AWS credentials required.",
      });
    }

    const credentials =
      parsed.data.accessKeyId && parsed.data.secretAccessKey
        ? {
            accessKeyId: parsed.data.accessKeyId,
            secretAccessKey: parsed.data.secretAccessKey,
          }
        : resolveAwsCredentialsFromConnection(conn);

    const identity = await testAwsCredentials(region, credentials);
    return NextResponse.json({
      ok: true,
      accountId: identity.accountId,
      arn: identity.arn,
      message: `Connected to AWS Account ${identity.accountId} (${identity.arn}).`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AWS connection test failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
