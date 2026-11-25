import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/scans/orchestrator";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await context.params;
    const decodedSlug = decodeURIComponent(slug);
    const data = await getDashboardData(true);

    const project = data.projects.find((p) => p.slug === decodedSlug);
    if (!project) {
      return NextResponse.json({ error: "Project not found in latest scan." }, { status: 404 });
    }

    const resources = data.resources.filter((r) => r.projectSlug === decodedSlug);
    const findings = data.findings.filter((f) => f.projectSlug === decodedSlug);

    return NextResponse.json({
      connection: data.connection,
      latestScan: data.latestScan,
      aiStatus: data.aiStatus,
      project,
      resources,
      findings,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load project.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
