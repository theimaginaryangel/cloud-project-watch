import { NextResponse } from "next/server";
import { getProjectDetailData } from "@/lib/scans/orchestrator";
import {
  enforceApiGuard,
  safeDecodeUriSegment,
  toErrorResponse,
} from "@/lib/security/guards";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const blocked = await enforceApiGuard(request);
  if (blocked) return blocked;

  try {
    const { slug } = await context.params;
    const decodedSlug = safeDecodeUriSegment(slug);
    const detail = await getProjectDetailData(decodedSlug, true);

    if (!detail) {
      return NextResponse.json({ error: "Project not found in latest scan." }, { status: 404 });
    }

    return NextResponse.json(detail);
  } catch (err) {
    return toErrorResponse(err, "Failed to load project.");
  }
}
