import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveAiCredentials } from "@/lib/ai/advisor";
import { verifyGeminiApiKey } from "@/lib/ai/providers/gemini";
import { verifyGroqApiKey } from "@/lib/ai/providers/groq";

const TestAiSchema = z.object({
  provider: z.enum(["gemini", "groq"]),
  apiKey: z.string().trim().optional(),
  modelId: z.string().trim().optional(),
});

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const parsed = TestAiSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid AI test request." }, { status: 400 });
    }

    const creds = await resolveAiCredentials();

    if (parsed.data.provider === "gemini") {
      const key = parsed.data.apiKey || creds.gemini?.apiKey;
      if (!key) {
        return NextResponse.json(
          { ok: false, error: "Enter a Gemini API key first." },
          { status: 400 },
        );
      }
      const result = await verifyGeminiApiKey(
        key,
        parsed.data.modelId || creds.gemini?.modelId,
      );
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    }

    const key = parsed.data.apiKey || creds.groq?.apiKey;
    if (!key) {
      return NextResponse.json(
        { ok: false, error: "Enter a Groq API key first." },
        { status: 400 },
      );
    }
    const result = await verifyGroqApiKey(
      key,
      parsed.data.modelId || creds.groq?.modelId,
    );
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI key verification failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
