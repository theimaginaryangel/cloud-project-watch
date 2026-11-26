import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveAiCredentials } from "@/lib/ai/advisor";
import { verifyGeminiApiKey } from "@/lib/ai/providers/gemini";
import { verifyGroqApiKey } from "@/lib/ai/providers/groq";
import {
  enforceApiGuard,
  parseJsonBody,
  sanitizeErrorMessage,
} from "@/lib/security/guards";

const TestAiSchema = z.object({
  provider: z.enum(["gemini", "groq"]),
  apiKey: z.string().trim().max(512).optional(),
  modelId: z.string().trim().max(100).optional(),
});

export async function POST(request: Request) {
  const blocked = await enforceApiGuard(request, {
    mutation: true,
    blockDemo: true,
    rateLimit: { bucket: "test_ai", limit: 10, windowMs: 60_000 },
  });
  if (blocked) return blocked;

  try {
    const parsed = await parseJsonBody(request, TestAiSchema, {
      invalidMessage: "Invalid AI test request.",
    });

    const creds = await resolveAiCredentials();

    if (parsed.provider === "gemini") {
      const key = parsed.apiKey || creds.gemini?.apiKey;
      if (!key) {
        return NextResponse.json(
          { ok: false, error: "Enter a Gemini API key first." },
          { status: 400 },
        );
      }
      const result = await verifyGeminiApiKey(
        key,
        parsed.modelId || creds.gemini?.modelId,
      );
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    }

    const key = parsed.apiKey || creds.groq?.apiKey;
    if (!key) {
      return NextResponse.json(
        { ok: false, error: "Enter a Groq API key first." },
        { status: 400 },
      );
    }
    const result = await verifyGroqApiKey(
      key,
      parsed.modelId || creds.groq?.modelId,
    );
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    const { message } = sanitizeErrorMessage(err, "AI key verification failed.");
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
