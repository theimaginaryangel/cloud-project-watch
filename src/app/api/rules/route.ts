import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureDbReady, projectRules } from "@/db";
import {
  ORPHANED_PROJECT_SLUG,
  humanizeProjectLabel,
  slugifyProject,
} from "@/lib/domain/types";
import { getOrCreatePrimaryConnection, triggerScan } from "@/lib/scans/orchestrator";
import {
  AppError,
  enforceApiGuard,
  isStatelessDemoMode,
  parseJsonBody,
  toErrorResponse,
} from "@/lib/security/guards";

const CreateRuleSchema = z.object({
  ruleType: z.enum(["arn_override", "tag_key", "name_prefix"]),
  pattern: z.string().trim().min(1).max(300),
  projectLabel: z.string().trim().min(1).max(80),
  rescanAfterSave: z.boolean().optional(),
});

const DeleteRuleSchema = z.object({
  id: z.string().uuid(),
});

export async function GET(request: Request) {
  const blocked = await enforceApiGuard(request);
  if (blocked) return blocked;

  if (isStatelessDemoMode()) {
    return NextResponse.json({ rules: [] });
  }

  try {
    const db = await ensureDbReady();
    const conn = await getOrCreatePrimaryConnection();
    const rules = await db
      .select()
      .from(projectRules)
      .where(eq(projectRules.connectionId, conn.id))
      .limit(200);
    return NextResponse.json({ rules });
  } catch (err) {
    return toErrorResponse(err, "Failed to load rules.");
  }
}

export async function POST(request: Request) {
  const blocked = await enforceApiGuard(request, {
    mutation: true,
    blockDemo: true,
    rateLimit: { bucket: "rules", limit: 30, windowMs: 60_000 },
  });
  if (blocked) return blocked;

  try {
    const parsed = await parseJsonBody(request, CreateRuleSchema, {
      invalidMessage: "Invalid rule payload.",
    });

    const projectLabel = humanizeProjectLabel(parsed.projectLabel);
    const projectSlug = slugifyProject(projectLabel);
    if (projectSlug === ORPHANED_PROJECT_SLUG) {
      throw new AppError("Choose a valid project name.", 400);
    }

    const db = await ensureDbReady();
    const conn = await getOrCreatePrimaryConnection();
    const priority =
      parsed.ruleType === "arn_override"
        ? 10
        : parsed.ruleType === "tag_key"
          ? 50
          : 100;

    const [saved] = await db
      .insert(projectRules)
      .values({
        connectionId: conn.id,
        ruleType: parsed.ruleType,
        pattern: parsed.pattern,
        projectSlug,
        projectLabel,
        priority,
      })
      .onConflictDoUpdate({
        target: [projectRules.connectionId, projectRules.ruleType, projectRules.pattern],
        set: { projectSlug, projectLabel, priority },
      })
      .returning();

    if (parsed.rescanAfterSave) {
      await triggerScan({
        connectionId: conn.id,
        idempotencyKey: `rule-rescan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      });
    }

    return NextResponse.json({ rule: saved }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err, "Failed to save rule.");
  }
}

export async function DELETE(request: Request) {
  const blocked = await enforceApiGuard(request, {
    mutation: true,
    blockDemo: true,
    rateLimit: { bucket: "rules", limit: 30, windowMs: 60_000 },
  });
  if (blocked) return blocked;

  try {
    const parsed = await parseJsonBody(request, DeleteRuleSchema, {
      invalidMessage: "Valid rule id is required.",
    });

    const db = await ensureDbReady();
    const conn = await getOrCreatePrimaryConnection();
    await db
      .delete(projectRules)
      .where(
        and(eq(projectRules.id, parsed.id), eq(projectRules.connectionId, conn.id)),
      );

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err, "Failed to delete rule.");
  }
}
