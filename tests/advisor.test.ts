import { describe, expect, it } from "vitest";
import {
  computeProjectSnapshotHash,
  runWithProviderFallback,
  type ResolvedAiCredentials,
} from "@/lib/ai/advisor";
import type { PricedResourceSnapshot, SurgicalPlan } from "@/lib/domain/types";

const MOCK_PLAN: SurgicalPlan = {
  summary: "Downgrade RDS IOPS to baseline gp3 without taking the app offline.",
  keepsAppLive: true,
  totalEstimatedMonthlySavingsCents: 60000,
  actions: [
    {
      title: "Switch RDS storage to gp3",
      targetResourceId: "cloudpress-db",
      estimatedMonthlySavingsCents: 60000,
      riskLevel: "low",
      downtimeImpact: "zero_downtime",
      keepsAppLive: true,
      explanation: "Baseline gp3 includes 3,000 IOPS free.",
      cliCommand: "aws rds modify-db-instance --db-instance-identifier cloudpress-db --storage-type gp3",
      terraformSnippet: 'storage_type = "gp3"',
    },
  ],
};

describe("Dual AI Advisor (Gemini + Groq) fallback & snapshot hashing", () => {
  it("falls back from Gemini to Groq when primary fails and fallback is enabled", async () => {
    const creds: ResolvedAiCredentials = {
      gemini: { apiKey: "gem-key", modelId: "gemini-2.5-flash" },
      groq: { apiKey: "groq-key", modelId: "llama-3.3-70b-versatile" },
      defaultProvider: "gemini",
      fallbackEnabled: true,
    };

    const called: string[] = [];
    const result = await runWithProviderFallback({
      preferred: "gemini",
      creds,
      prompt: "test",
      invoker: async (provider) => {
        called.push(provider);
        if (provider === "gemini") {
          throw new Error("429 Quota exceeded");
        }
        return { plan: MOCK_PLAN, modelId: "llama-3.3-70b-versatile" };
      },
    });

    expect(called).toEqual(["gemini", "groq"]);
    expect(result.providerUsed).toBe("groq");
    expect(result.usedFallback).toBe(true);
  });

  it("does NOT fall back when fallbackEnabled is false", async () => {
    const creds: ResolvedAiCredentials = {
      gemini: { apiKey: "gem-key", modelId: "gemini-2.5-flash" },
      groq: { apiKey: "groq-key", modelId: "llama-3.3-70b-versatile" },
      defaultProvider: "gemini",
      fallbackEnabled: false,
    };

    await expect(
      runWithProviderFallback({
        preferred: "gemini",
        creds,
        prompt: "test",
        invoker: async () => {
          throw new Error("429 Quota exceeded");
        },
      }),
    ).rejects.toThrow("429 Quota exceeded");
  });

  it("computes deterministic order-independent snapshot hashes", () => {
    const r1: PricedResourceSnapshot = {
      arn: "arn:a",
      resourceId: "a",
      service: "eip",
      region: "us-east-1",
      name: "1.1.1.1",
      state: "unassociated",
      tags: {},
      metadata: { attached: false },
      projectSlug: "cloudpress",
      projectLabel: "CloudPress",
      projectSource: "tag",
      hourlyMicrocents: 500000,
      monthlyCents: 365,
    };
    const r2: PricedResourceSnapshot = {
      ...r1,
      arn: "arn:b",
      resourceId: "b",
    };

    expect(computeProjectSnapshotHash("cloudpress", [r1, r2])).toBe(
      computeProjectSnapshotHash("cloudpress", [r2, r1]),
    );
  });
});
