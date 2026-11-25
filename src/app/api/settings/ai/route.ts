import { NextResponse } from "next/server";
import { z } from "zod";
import { aiProviderConfigs, ensureDbReady } from "@/db";
import { DEFAULT_GEMINI_MODEL } from "@/lib/ai/providers/gemini";
import { DEFAULT_GROQ_MODEL } from "@/lib/ai/providers/groq";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/crypto";
import { blockIfPublicDemoLocked } from "@/lib/security/guards";

const SaveAiSettingsSchema = z.object({
  geminiApiKey: z.string().trim().optional(),
  geminiModel: z.string().trim().min(2).max(100).optional(),
  clearGeminiKey: z.boolean().optional(),
  groqApiKey: z.string().trim().optional(),
  groqModel: z.string().trim().min(2).max(100).optional(),
  clearGroqKey: z.boolean().optional(),
  defaultProvider: z.enum(["gemini", "groq", "auto"]),
  fallbackEnabled: z.boolean(),
});

export async function GET() {
  try {
    const db = await ensureDbReady();
    const rows = await db.select().from(aiProviderConfigs);
    const geminiRow = rows.find((r) => r.provider === "gemini");
    const groqRow = rows.find((r) => r.provider === "groq");

    const geminiDecrypted = geminiRow?.encryptedApiKey
      ? decryptSecret(geminiRow.encryptedApiKey)
      : process.env.GEMINI_API_KEY;
    const groqDecrypted = groqRow?.encryptedApiKey
      ? decryptSecret(groqRow.encryptedApiKey)
      : process.env.GROQ_API_KEY;

    let defaultProvider: "gemini" | "groq" | "auto" = "auto";
    if (geminiRow?.isDefault) defaultProvider = "gemini";
    else if (groqRow?.isDefault) defaultProvider = "groq";

    return NextResponse.json({
      gemini: {
        ...maskSecret(geminiDecrypted),
        source: geminiRow?.encryptedApiKey
          ? "saved"
          : process.env.GEMINI_API_KEY
            ? "env"
            : "none",
        modelId: geminiRow?.modelId ?? process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
      },
      groq: {
        ...maskSecret(groqDecrypted),
        source: groqRow?.encryptedApiKey
          ? "saved"
          : process.env.GROQ_API_KEY
            ? "env"
            : "none",
        modelId: groqRow?.modelId ?? process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL,
      },
      defaultProvider,
      fallbackEnabled: geminiRow?.fallbackEnabled ?? groqRow?.fallbackEnabled ?? true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load AI settings.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const locked = blockIfPublicDemoLocked();
  if (locked) return locked;

  try {
    const body: unknown = await request.json();
    const parsed = SaveAiSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid AI settings payload." }, { status: 400 });
    }

    const db = await ensureDbReady();
    const existing = await db.select().from(aiProviderConfigs);
    const existingGemini = existing.find((r) => r.provider === "gemini");
    const existingGroq = existing.find((r) => r.provider === "groq");

    const nextGeminiEncrypted = parsed.data.clearGeminiKey
      ? null
      : parsed.data.geminiApiKey
        ? encryptSecret(parsed.data.geminiApiKey)
        : (existingGemini?.encryptedApiKey ?? null);

    const nextGroqEncrypted = parsed.data.clearGroqKey
      ? null
      : parsed.data.groqApiKey
        ? encryptSecret(parsed.data.groqApiKey)
        : (existingGroq?.encryptedApiKey ?? null);

    await db.transaction(async (tx) => {
      await tx
        .insert(aiProviderConfigs)
        .values({
          provider: "gemini",
          encryptedApiKey: nextGeminiEncrypted,
          modelId: parsed.data.geminiModel || DEFAULT_GEMINI_MODEL,
          isDefault: parsed.data.defaultProvider === "gemini",
          fallbackEnabled: parsed.data.fallbackEnabled,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: aiProviderConfigs.provider,
          set: {
            encryptedApiKey: nextGeminiEncrypted,
            modelId: parsed.data.geminiModel || DEFAULT_GEMINI_MODEL,
            isDefault: parsed.data.defaultProvider === "gemini",
            fallbackEnabled: parsed.data.fallbackEnabled,
            updatedAt: new Date(),
          },
        });

      await tx
        .insert(aiProviderConfigs)
        .values({
          provider: "groq",
          encryptedApiKey: nextGroqEncrypted,
          modelId: parsed.data.groqModel || DEFAULT_GROQ_MODEL,
          isDefault: parsed.data.defaultProvider === "groq",
          fallbackEnabled: parsed.data.fallbackEnabled,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: aiProviderConfigs.provider,
          set: {
            encryptedApiKey: nextGroqEncrypted,
            modelId: parsed.data.groqModel || DEFAULT_GROQ_MODEL,
            isDefault: parsed.data.defaultProvider === "groq",
            fallbackEnabled: parsed.data.fallbackEnabled,
            updatedAt: new Date(),
          },
        });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save AI settings.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
