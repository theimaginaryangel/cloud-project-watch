import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { aiProviderConfigs, aiRecommendations, ensureDbReady } from "@/db";
import {
  DEFAULT_GEMINI_MODEL,
  generateGeminiSurgicalPlan,
} from "@/lib/ai/providers/gemini";
import {
  DEFAULT_GROQ_MODEL,
  generateGroqSurgicalPlan,
} from "@/lib/ai/providers/groq";
import { getDemoSurgicalPlan } from "@/lib/aws/demo-provider";
import { decryptSecret } from "@/lib/crypto";
import type {
  AiProviderId,
  AiProviderPreference,
  ComputedRuleFinding,
  PricedResourceSnapshot,
  SurgicalPlan,
} from "@/lib/domain/types";

export interface ResolvedAiCredentials {
  gemini?: { apiKey: string; modelId: string };
  groq?: { apiKey: string; modelId: string };
  defaultProvider: AiProviderPreference;
  fallbackEnabled: boolean;
}

export function computeProjectSnapshotHash(
  projectSlug: string,
  resources: PricedResourceSnapshot[],
): string {
  const normalized = [...resources]
    .sort((a, b) => a.arn.localeCompare(b.arn))
    .map((r) => ({
      arn: r.arn,
      service: r.service,
      state: r.state,
      monthlyCents: r.monthlyCents,
      metadata: r.metadata,
    }));

  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ projectSlug, resources: normalized }))
    .digest("hex");
}

export function buildSurgicalPrompt(
  projectLabel: string,
  resources: PricedResourceSnapshot[],
  findings: ComputedRuleFinding[],
): string {
  const compactResources = resources.map((r) => ({
    id: r.resourceId,
    service: r.service,
    region: r.region,
    state: r.state,
    monthlyUsd: (r.monthlyCents / 100).toFixed(2),
    metadata: r.metadata,
  }));

  const compactFindings = findings.map((f) => ({
    rule: f.ruleCode,
    resourceId: f.resourceId,
    savingsUsd: (f.estimatedMonthlySavingsCents / 100).toFixed(2),
    title: f.title,
  }));

  return `Analyze the live AWS resources for project "${projectLabel}" and return a surgical cost-cutting plan that keeps the application LIVE (do NOT suggest terraform destroy).

Resources:
${JSON.stringify(compactResources, null, 2)}

Deterministic Rule Findings Already Detected:
${JSON.stringify(compactFindings, null, 2)}

Return STRICT JSON matching this exact shape (all money values MUST be non-negative integer cents):
{
  "summary": "2-3 concrete sentences summarizing total savings while keeping the app online",
  "keepsAppLive": true,
  "totalEstimatedMonthlySavingsCents": 12000,
  "actions": [
    {
      "title": "Short imperative action title",
      "targetResourceId": "exact resource id from input",
      "estimatedMonthlySavingsCents": 12000,
      "riskLevel": "low" | "medium" | "high",
      "downtimeImpact": "zero_downtime" | "brief_restart" | "scheduled_window",
      "keepsAppLive": true,
      "explanation": "Clear human explanation of why this saves money safely",
      "cliCommand": "exact copy-paste aws cli command",
      "terraformSnippet": "short terraform config snippet"
    }
  ]
}`;
}

export async function resolveAiCredentials(): Promise<ResolvedAiCredentials> {
  const db = await ensureDbReady();
  const rows = await db.select().from(aiProviderConfigs);

  const geminiRow = rows.find((r) => r.provider === "gemini");
  const groqRow = rows.find((r) => r.provider === "groq");

  const geminiKey =
    (geminiRow?.encryptedApiKey ? decryptSecret(geminiRow.encryptedApiKey) : null) ??
    process.env.GEMINI_API_KEY?.trim() ??
    null;

  const groqKey =
    (groqRow?.encryptedApiKey ? decryptSecret(groqRow.encryptedApiKey) : null) ??
    process.env.GROQ_API_KEY?.trim() ??
    null;

  const envDefault = process.env.DEFAULT_AI_PROVIDER;
  let defaultProvider: AiProviderPreference = "auto";
  if (geminiRow?.isDefault) defaultProvider = "gemini";
  else if (groqRow?.isDefault) defaultProvider = "groq";
  else if (envDefault === "gemini" || envDefault === "groq" || envDefault === "auto") {
    defaultProvider = envDefault;
  }

  const fallbackEnabled =
    geminiRow?.fallbackEnabled ?? groqRow?.fallbackEnabled ?? true;

  return {
    ...(geminiKey
      ? {
          gemini: {
            apiKey: geminiKey,
            modelId: geminiRow?.modelId || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
          },
        }
      : {}),
    ...(groqKey
      ? {
          groq: {
            apiKey: groqKey,
            modelId: groqRow?.modelId || process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL,
          },
        }
      : {}),
    defaultProvider,
    fallbackEnabled,
  };
}

export type ProviderInvoker = (
  provider: AiProviderId,
  prompt: string,
  creds: ResolvedAiCredentials,
) => Promise<{ plan: SurgicalPlan; modelId: string }>;

const defaultInvoker: ProviderInvoker = async (provider, prompt, creds) => {
  if (provider === "gemini") {
    if (!creds.gemini) throw new Error("Gemini API key is not configured.");
    return generateGeminiSurgicalPlan({
      apiKey: creds.gemini.apiKey,
      modelId: creds.gemini.modelId,
      prompt,
    });
  }
  if (!creds.groq) throw new Error("Groq API key is not configured.");
  return generateGroqSurgicalPlan({
    apiKey: creds.groq.apiKey,
    modelId: creds.groq.modelId,
    prompt,
  });
};

export async function runWithProviderFallback(params: {
  preferred: AiProviderPreference;
  creds: ResolvedAiCredentials;
  prompt: string;
  invoker?: ProviderInvoker;
}): Promise<{
  providerUsed: AiProviderId;
  modelId: string;
  plan: SurgicalPlan;
  usedFallback: boolean;
}> {
  const invoker = params.invoker ?? defaultInvoker;
  const order: AiProviderId[] = [];

  if (params.preferred === "gemini") {
    if (params.creds.gemini) order.push("gemini");
    if (params.creds.fallbackEnabled && params.creds.groq) order.push("groq");
  } else if (params.preferred === "groq") {
    if (params.creds.groq) order.push("groq");
    if (params.creds.fallbackEnabled && params.creds.gemini) order.push("gemini");
  } else {
    if (params.creds.gemini) order.push("gemini");
    if (params.creds.groq) order.push("groq");
  }

  if (order.length === 0) {
    throw new Error(
      "No AI provider key configured. Add a Gemini or Groq API key in Settings (BYOK).",
    );
  }

  let lastError: unknown;
  for (let i = 0; i < order.length; i += 1) {
    const provider = order[i];
    if (!provider) continue;
    try {
      const result = await invoker(provider, params.prompt, params.creds);
      return {
        providerUsed: provider,
        modelId: result.modelId,
        plan: result.plan,
        usedFallback: i > 0,
      };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("All configured AI providers failed.");
}

export interface AdvisorResponse {
  source: "cache" | "live" | "demo";
  provider: AiProviderId;
  modelId: string;
  usedFallback: boolean;
  snapshotHash: string;
  plan: SurgicalPlan;
  createdAt: string;
}

export async function generateOrFetchSurgicalPlan(params: {
  connectionId: string;
  connectionMode: "demo" | "iam_keys" | "env_default";
  projectSlug: string;
  projectLabel: string;
  resources: PricedResourceSnapshot[];
  findings: ComputedRuleFinding[];
  preferredProvider?: AiProviderPreference;
  forceRefresh?: boolean;
}): Promise<AdvisorResponse> {
  const db = await ensureDbReady();
  const snapshotHash = computeProjectSnapshotHash(params.projectSlug, params.resources);
  const creds = await resolveAiCredentials();
  const preferred = params.preferredProvider ?? creds.defaultProvider;

  const hasLiveAiKey = Boolean(creds.gemini || creds.groq);

  // If no AI key is configured yet and user is in Demo Mode, return instant realistic demo plan.
  if (!hasLiveAiKey && params.connectionMode === "demo") {
    const demoProvider: AiProviderId = preferred === "groq" ? "groq" : "gemini";
    return {
      source: "demo",
      provider: demoProvider,
      modelId: demoProvider === "groq" ? DEFAULT_GROQ_MODEL : DEFAULT_GEMINI_MODEL,
      usedFallback: false,
      snapshotHash,
      plan: getDemoSurgicalPlan(params.projectSlug),
      createdAt: new Date().toISOString(),
    };
  }

  const cacheProviderFilter: AiProviderId | null =
    preferred === "gemini" || preferred === "groq" ? preferred : null;

  if (!params.forceRefresh) {
    const cachedRows = await db
      .select()
      .from(aiRecommendations)
      .where(
        and(
          eq(aiRecommendations.connectionId, params.connectionId),
          eq(aiRecommendations.projectSlug, params.projectSlug),
          eq(aiRecommendations.snapshotHash, snapshotHash),
          ...(cacheProviderFilter ? [eq(aiRecommendations.provider, cacheProviderFilter)] : []),
        ),
      )
      .limit(1);

    const cached = cachedRows[0];
    if (cached) {
      return {
        source: "cache",
        provider: cached.provider,
        modelId: cached.modelId,
        usedFallback: false,
        snapshotHash: cached.snapshotHash,
        plan: cached.planJson as SurgicalPlan,
        createdAt: cached.createdAt.toISOString(),
      };
    }
  }

  const prompt = buildSurgicalPrompt(
    params.projectLabel,
    params.resources,
    params.findings,
  );

  const generated = await runWithProviderFallback({
    preferred,
    creds,
    prompt,
  });

  const [saved] = await db
    .insert(aiRecommendations)
    .values({
      connectionId: params.connectionId,
      projectSlug: params.projectSlug,
      snapshotHash,
      provider: generated.providerUsed,
      modelId: generated.modelId,
      planJson: generated.plan,
      estimatedMonthlySavingsCents: generated.plan.totalEstimatedMonthlySavingsCents,
    })
    .onConflictDoUpdate({
      target: [
        aiRecommendations.connectionId,
        aiRecommendations.projectSlug,
        aiRecommendations.snapshotHash,
        aiRecommendations.provider,
      ],
      set: {
        modelId: generated.modelId,
        planJson: generated.plan,
        estimatedMonthlySavingsCents: generated.plan.totalEstimatedMonthlySavingsCents,
        createdAt: new Date(),
      },
    })
    .returning();

  return {
    source: "live",
    provider: generated.providerUsed,
    modelId: generated.modelId,
    usedFallback: generated.usedFallback,
    snapshotHash,
    plan: generated.plan,
    createdAt: saved?.createdAt.toISOString() ?? new Date().toISOString(),
  };
}
