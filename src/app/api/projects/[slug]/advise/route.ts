import { NextResponse } from "next/server";
import { z } from "zod";
import { generateOrFetchRecommendations } from "@/lib/ai/advisor";
import type { ComputedRuleFinding, PricedResourceSnapshot } from "@/lib/domain/types";
import { getProjectDetailData } from "@/lib/scans/orchestrator";
import {
  blockIfPublicDemoLocked,
  enforceApiGuard,
  isStatelessDemoMode,
  parseJsonBody,
  safeDecodeUriSegment,
  toErrorResponse,
} from "@/lib/security/guards";

const AdviseRequestSchema = z.object({
  provider: z.enum(["gemini", "groq", "auto"]).optional(),
  forceRefresh: z.boolean().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const blocked = await enforceApiGuard(request, {
    mutation: true,
    rateLimit: { bucket: "advise", limit: 15, windowMs: 60_000 },
  });
  if (blocked) return blocked;

  if (!isStatelessDemoMode()) {
    const demoLocked = blockIfPublicDemoLocked();
    if (demoLocked) return demoLocked;
  }

  try {
    const { slug } = await context.params;
    const decodedSlug = safeDecodeUriSegment(slug);

    const parsedBody = await parseJsonBody(request, AdviseRequestSchema, {
      allowEmpty: true,
      invalidMessage: "Invalid AI advisor request.",
    });

    const detail = await getProjectDetailData(decodedSlug, true);
    if (!detail) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const projectResources: PricedResourceSnapshot[] = detail.resources.map((r) => ({
      arn: r.arn,
      resourceId: r.resourceId,
      service: r.service,
      region: r.region,
      name: r.name,
      state: r.state,
      tags: r.tags,
      metadata: r.metadata,
      projectSlug: r.projectSlug,
      projectLabel: r.projectLabel,
      projectSource: r.projectSource,
      hourlyMicrocents: r.hourlyMicrocents,
      monthlyCents: r.monthlyCents,
    }));

    const projectFindings: ComputedRuleFinding[] = detail.findings.map((f) => ({
      resourceId: f.resourceId,
      resourceArn: f.resourceArn,
      projectSlug: f.projectSlug,
      ruleCode: f.ruleCode,
      severity: f.severity,
      title: f.title,
      description: f.description,
      estimatedMonthlySavingsCents: f.estimatedMonthlySavingsCents,
      cliCommand: f.cliCommand,
      terraformHint: f.terraformHint,
      keepsAppLive: f.keepsAppLive,
    }));

    const result = await generateOrFetchRecommendations({
      connectionId: detail.connection.id,
      connectionMode: detail.connection.mode,
      projectSlug: detail.project.slug,
      projectLabel: detail.project.label,
      resources: projectResources,
      findings: projectFindings,
      preferredProvider: parsedBody.provider,
      forceRefresh: parsedBody.forceRefresh,
    });

    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err, "Failed to generate cost recommendations.");
  }
}
