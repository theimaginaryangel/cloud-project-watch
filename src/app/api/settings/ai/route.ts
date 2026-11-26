import { NextResponse } from "next/server";
import { z } from "zod";
import { aiProviderConfigs, ensureDbReady } from "@/db";
import { DEFAULT_GEMINI_MODEL } from "@/lib/ai/providers/gemini";
import { DEFAULT_GROQ_MODEL } from "@/lib/ai/providers/groq";
import { encryptSecret, maskSecret, tryDecryptSecret } from "@/lib/crypto";
import {
  enforceApiGuard,
  isStatelessDemoMode,
  parseJsonBody,
  toErrorResponse,
} from "@/lib/security/guards";

const SaveAiSettingsSchema = z.object({
  geminiApiKey: z.string().trim().max(512).optional(),
  geminiModel: z.string().trim().min(2).max(100).optional(),
  clearGeminiKey: z.boolean().optional(),
  groqApiKey: z.string().trim().max(512).optional(),
  groqModel: z.string().trim().min(2).max(100).optional(),
  clearGroqKey: z.boolean().optional(),
  defaultProvider: z.enum(["gemini", "groq", "auto"]),
  fallbackEnabled: z.boolean(),
});

export async function GET(request: Request) {
  const blocked = await enforceApiGuard(request);
  if (blocked) return blocked;

  if (isStatelessDemoMode()) {
    return NextResponse.json({
      gemini: {
        configured: false,
        last4: null,
        source: "none",
        modelId: DEFAULT_GEMINI_MODEL,
      },
      groq: {
        configured: false,
        last4: null,
        source: "none",
        modelId: DEFAULT_GROQ_MODEL,
      },
      defaultProvider: "auto",
      fallbackEnabled: true,
    });
  }

  try {
    const db = await ensureDbReady();
    const rows = await db.select().from(aiProviderConfigs);
    const geminiRow = rows.find((r) => r.provider === "gemini");
    const groqRow = rows.find((r) => r.provider === "groq");

    const geminiSavedPlain = tryDecryptSecret(geminiRow?.encryptedApiKey);
    const groqSavedPlain = tryDecryptSecret(groqRow?.encryptedApiKey);

    const geminiEffective = geminiSavedPlain ?? process.env.GEMINI_API_KEY?.trim();
    const groqEffective = groqSavedPlain ?? process.env.GROQ_API_KEY?.trim();

    let defaultProvider: "gemini" | "groq" | "auto" = "auto";
    if (geminiRow?.isDefault) defaultProvider = "gemini";
    else if (groqRow?.isDefault) defaultProvider = "groq";

    return NextResponse.json({
      gemini: {
        ...maskSecret(geminiEffective),
        source: geminiSavedPlain
          ? "saved"
          : process.env.GEMINI_API_KEY?.trim()
            ? "env"
            : "none",
        modelId: geminiRow?.modelId ?? process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
      },
      groq: {
        ...maskSecret(groqEffective),
        source: groqSavedPlain
          ? "saved"
          : process.env.GROQ_API_KEY?.trim()
            ? "env"
            : "none",
        modelId: groqRow?.modelId ?? process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL,
      },
      defaultProvider,
      fallbackEnabled: geminiRow?.fallbackEnabled ?? groqRow?.fallbackEnabled ?? true,
    });
  } catch (err) {
    return toErrorResponse(err, "Failed to load AI settings.");
  }
}

export async function POST(request: Request) {
  const blocked = await enforceApiGuard(request, {
    mutation: true,
    blockDemo: true,
    rateLimit: { bucket: "settings_ai", limit: 20, windowMs: 60_000 },
  });
  if (blocked) return blocked;

  try {
    const parsed = await parseJsonBody(request, SaveAiSettingsSchema, {
      invalidMessage: "Invalid AI settings payload.",
    });

    const db = await ensureDbReady();
    const existing = await db.select().from(aiProviderConfigs);
    const existingGemini = existing.find((r) => r.provider === "gemini");
    const existingGroq = existing.find((r) => r.provider === "groq");

    const nextGeminiEncrypted = parsed.clearGeminiKey
      ? null
      : parsed.geminiApiKey
        ? encryptSecret(parsed.geminiApiKey)
        : (existingGemini?.encryptedApiKey ?? null);

    const nextGroqEncrypted = parsed.clearGroqKey
      ? null
      : parsed.groqApiKey
        ? encryptSecret(parsed.groqApiKey)
        : (existingGroq?.encryptedApiKey ?? null);

    await db.transaction(async (tx) => {
      await tx
        .insert(aiProviderConfigs)
        .values({
          provider: "gemini",
          encryptedApiKey: nextGeminiEncrypted,
          modelId: parsed.geminiModel || DEFAULT_GEMINI_MODEL,
          isDefault: parsed.defaultProvider === "gemini",
          fallbackEnabled: parsed.fallbackEnabled,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: aiProviderConfigs.provider,
          set: {
            encryptedApiKey: nextGeminiEncrypted,
            modelId: parsed.geminiModel || DEFAULT_GEMINI_MODEL,
            isDefault: parsed.defaultProvider === "gemini",
            fallbackEnabled: parsed.fallbackEnabled,
            updatedAt: new Date(),
          },
        });

      await tx
        .insert(aiProviderConfigs)
        .values({
          provider: "groq",
          encryptedApiKey: nextGroqEncrypted,
          modelId: parsed.groqModel || DEFAULT_GROQ_MODEL,
          isDefault: parsed.defaultProvider === "groq",
          fallbackEnabled: parsed.fallbackEnabled,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: aiProviderConfigs.provider,
          set: {
            encryptedApiKey: nextGroqEncrypted,
            modelId: parsed.groqModel || DEFAULT_GROQ_MODEL,
            isDefault: parsed.defaultProvider === "groq",
            fallbackEnabled: parsed.fallbackEnabled,
            updatedAt: new Date(),
          },
        });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err, "Failed to save AI settings.");
  }
}
