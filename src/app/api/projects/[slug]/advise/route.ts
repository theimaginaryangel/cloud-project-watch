import { NextResponse } from "next/server";
import { z } from "zod";
import { generateOrFetchSurgicalPlan } from "@/lib/ai/advisor";
import type { ComputedRuleFinding, PricedResourceSnapshot } from "@/lib/domain/types";
import { getDashboardData } from "@/lib/scans/orchestrator";

const AdviseRequestSchema = z.object({
  provider: z.enum(["gemini", "groq", "auto"]).optional(),
  forceRefresh: z.boolean().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await context.params;
    const decodedSlug = decodeURIComponent(slug);

    const rawBody = await request.text();
    const parsedBody = rawBody
      ? AdviseRequestSchema.safeParse(JSON.parse(rawBody))
      : { success: true as const, data: {} };

    if (!parsedBody.success) {
      return NextResponse.json({ error: "Invalid AI advisor request." }, { status: 400 });
    }

    const data = await getDashboardData(true);
    const project = data.projects.find((p) => p.slug === decodedSlug);
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const projectResources: PricedResourceSnapshot[] = data.resources
      .filter((r) => r.projectSlug === decodedSlug)
      .map((r) => ({
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

    const projectFindings: ComputedRuleFinding[] = data.findings
      .filter((f) => f.projectSlug === decodedSlug)
      .map((f) => ({
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

    const result = await generateOrFetchSurgicalPlan({
      connectionId: data.connection.id,
      connectionMode: data.connection.mode,
      projectSlug: project.slug,
      projectLabel: project.label,
      resources: projectResources,
      findings: projectFindings,
      preferredProvider: parsedBody.data.provider,
      forceRefresh: parsedBody.data.forceRefresh,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to generate surgical AI plan.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
