import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureDbReady, projectRules } from "@/db";
import { humanizeProjectLabel, slugifyProject } from "@/lib/domain/types";
import { getOrCreatePrimaryConnection, triggerScan } from "@/lib/scans/orchestrator";

const CreateRuleSchema = z.object({
  ruleType: z.enum(["arn_override", "tag_key", "name_prefix"]),
  pattern: z.string().min(1).max(300),
  projectLabel: z.string().min(1).max(80),
  rescanAfterSave: z.boolean().optional(),
});

const DeleteRuleSchema = z.object({
  id: z.string().uuid(),
});

export async function GET() {
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
    const message = err instanceof Error ? err.message : "Failed to load rules.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const parsed = CreateRuleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid rule payload." }, { status: 400 });
    }

    const db = await ensureDbReady();
    const conn = await getOrCreatePrimaryConnection();
    const projectLabel = humanizeProjectLabel(parsed.data.projectLabel);
    const projectSlug = slugifyProject(projectLabel);
    const priority =
      parsed.data.ruleType === "arn_override"
        ? 10
        : parsed.data.ruleType === "tag_key"
          ? 50
          : 100;

    const [saved] = await db
      .insert(projectRules)
      .values({
        connectionId: conn.id,
        ruleType: parsed.data.ruleType,
        pattern: parsed.data.pattern.trim(),
        projectSlug,
        projectLabel,
        priority,
      })
      .onConflictDoUpdate({
        target: [projectRules.connectionId, projectRules.ruleType, projectRules.pattern],
        set: { projectSlug, projectLabel, priority },
      })
      .returning();

    if (parsed.data.rescanAfterSave) {
      await triggerScan({
        connectionId: conn.id,
        idempotencyKey: `rule-rescan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      });
    }

    return NextResponse.json({ rule: saved }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save rule.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body: unknown = await request.json();
    const parsed = DeleteRuleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Valid rule id is required." }, { status: 400 });
    }

    const db = await ensureDbReady();
    const conn = await getOrCreatePrimaryConnection();
    await db
      .delete(projectRules)
      .where(
        and(eq(projectRules.id, parsed.data.id), eq(projectRules.connectionId, conn.id)),
      );

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete rule.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
