import Groq from "groq-sdk";
import {
  CostRecommendationPlanSchema,
  type CostRecommendationPlan,
} from "@/lib/domain/types";

export const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";

export async function generateGroqRecommendations(params: {
  apiKey: string;
  modelId?: string;
  prompt: string;
}): Promise<{ plan: CostRecommendationPlan; modelId: string }> {
  const modelId = params.modelId?.trim() || DEFAULT_GROQ_MODEL;
  const groq = new Groq({ apiKey: params.apiKey, timeout: 15_000 });

  const completion = await groq.chat.completions.create({
    model: modelId,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a senior AWS infrastructure engineer. Return ONLY valid JSON matching the exact requested schema. Never recommend terraform destroy when a non-destructive change keeps the app online.",
      },
      {
        role: "user",
        content: params.prompt,
      },
    ],
  });

  const rawText = completion.choices[0]?.message?.content?.trim();
  if (!rawText) {
    throw new Error("Groq returned an empty response.");
  }

  const parsed: unknown = JSON.parse(rawText);
  const validated = CostRecommendationPlanSchema.parse(parsed);
  return { plan: validated, modelId };
}

export async function verifyGroqApiKey(
  apiKey: string,
  modelId?: string,
): Promise<{ ok: boolean; modelId: string; message: string }> {
  const resolvedModel = modelId?.trim() || DEFAULT_GROQ_MODEL;
  const groq = new Groq({ apiKey, timeout: 10_000 });

  const completion = await groq.chat.completions.create({
    model: resolvedModel,
    max_tokens: 16,
    temperature: 0,
    messages: [{ role: "user", content: "Reply with OK" }],
  });

  if (!completion.choices[0]?.message?.content) {
    return { ok: false, modelId: resolvedModel, message: "Empty response from Groq." };
  }

  return {
    ok: true,
    modelId: resolvedModel,
    message: `Connected to Groq (${resolvedModel}).`,
  };
}
