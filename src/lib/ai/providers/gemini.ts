import { GoogleGenAI } from "@google/genai";
import {
  CostRecommendationPlanSchema,
  type CostRecommendationPlan,
} from "@/lib/domain/types";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

export async function generateGeminiRecommendations(params: {
  apiKey: string;
  modelId?: string;
  prompt: string;
}): Promise<{ plan: CostRecommendationPlan; modelId: string }> {
  const modelId = params.modelId?.trim() || DEFAULT_GEMINI_MODEL;
  const ai = new GoogleGenAI({ apiKey: params.apiKey });

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Gemini request timed out after 15s.")), 15_000);
  });

  const response = await Promise.race([
    ai.models.generateContent({
      model: modelId,
      contents: params.prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.2,
      },
    }),
    timeoutPromise,
  ]);

  const rawText = response.text?.trim();
  if (!rawText) {
    throw new Error("Gemini returned an empty response.");
  }

  const parsed: unknown = JSON.parse(rawText);
  const validated = CostRecommendationPlanSchema.parse(parsed);
  return { plan: validated, modelId };
}

export async function verifyGeminiApiKey(
  apiKey: string,
  modelId?: string,
): Promise<{ ok: boolean; modelId: string; message: string }> {
  const resolvedModel = modelId?.trim() || DEFAULT_GEMINI_MODEL;
  const ai = new GoogleGenAI({ apiKey });

  const response = await Promise.race([
    ai.models.generateContent({
      model: resolvedModel,
      contents: 'Reply with strictly: {"ok":true}',
      config: { responseMimeType: "application/json", temperature: 0 },
    }),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Gemini verification timed out.")), 10_000);
    }),
  ]);

  if (!response.text) {
    return { ok: false, modelId: resolvedModel, message: "Empty response from Gemini." };
  }

  return {
    ok: true,
    modelId: resolvedModel,
    message: `Connected to Gemini (${resolvedModel}).`,
  };
}
