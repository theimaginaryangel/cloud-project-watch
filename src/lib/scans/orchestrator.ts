import { and, desc, eq } from "drizzle-orm";
import {
  aiProviderConfigs,
  awsConnections,
  awsResources,
  costExplorerSyncs,
  ensureDbReady,
  projectRules,
  ruleFindings,
  scanRuns,
} from "@/db";
import { getDemoAwsResources } from "@/lib/aws/demo-provider";
import { scanLiveAwsAccount, type AwsClientCredentials } from "@/lib/aws/scanner";
import { decryptSecret } from "@/lib/crypto";
import {
  ORPHANED_PROJECT_LABEL,
  ORPHANED_PROJECT_SLUG,
  type AwsService,
  type ComputedRuleFinding,
  type PricedResourceSnapshot,
  type ProjectRuleInput,
  type RuleCode,
  type Severity,
} from "@/lib/domain/types";
import { groupAndPriceResources } from "@/lib/grouping/project-grouper";
import { evaluateZombieRules } from "@/lib/rules/zombie-engine";

export interface StoredAwsCredsPayload {
  accessKeyId: string;
  secretAccessKey: string;
}

export class ScanConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScanConflictError";
  }
}

export async function getOrCreatePrimaryConnection() {
  const db = await ensureDbReady();
  const [existing] = await db
    .select()
    .from(awsConnections)
    .orderBy(awsConnections.createdAt)
    .limit(1);

  if (existing) return existing;

  const isDemo = (process.env.DEMO_MODE ?? "true").toLowerCase() !== "false";
  const hasEnvAws = Boolean(
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY,
  );
  const mode = !isDemo && hasEnvAws ? "env_default" : "demo";

  const [created] = await db
    .insert(awsConnections)
    .values({
      name: mode === "demo" ? "Portfolio Demo AWS" : "Primary AWS",
      mode,
      regions: ["us-east-1", "us-east-2", "us-west-2"],
      costExplorerEnabled: false,
    })
    .returning();

  if (!created) {
    throw new Error("Failed to initialize AWS connection.");
  }

  return created;
}

export function resolveAwsCredentialsFromConnection(conn: {
  mode: "demo" | "iam_keys" | "env_default";
  encryptedCredentials: string | null;
}): AwsClientCredentials | undefined {
  if (conn.mode === "iam_keys" && conn.encryptedCredentials) {
    const parsed = JSON.parse(
      decryptSecret(conn.encryptedCredentials),
    ) as StoredAwsCredsPayload;
    return {
      accessKeyId: parsed.accessKeyId,
      secretAccessKey: parsed.secretAccessKey,
    };
  }
  return undefined;
}

export async function triggerScan(params: {
  connectionId?: string;
  idempotencyKey: string;
}) {
  const db = await ensureDbReady();
  const conn = params.connectionId
    ? (
        await db
          .select()
          .from(awsConnections)
          .where(eq(awsConnections.id, params.connectionId))
          .limit(1)
      )[0]
    : await getOrCreatePrimaryConnection();

  if (!conn) {
    throw new Error("AWS connection not found.");
  }

  // Check if this exact idempotencyKey already ran (retry safety).
  const [existingByKey] = await db
    .select()
    .from(scanRuns)
    .where(eq(scanRuns.idempotencyKey, params.idempotencyKey))
    .limit(1);

  if (existingByKey) {
    return { scanRun: existingByKey, deduplicated: true, warnings: [] as string[] };
  }

  // Insert running scan row. Partial unique index (connection_id WHERE status='running')
  // guarantees atomic protection against concurrent double-clicks or multi-tab races.
  let scanRun: typeof scanRuns.$inferSelect;
  try {
    const [inserted] = await db
      .insert(scanRuns)
      .values({
        connectionId: conn.id,
        idempotencyKey: params.idempotencyKey,
        status: "running",
        regionsScanned: conn.regions,
      })
      .returning();

    if (!inserted) {
      throw new Error("Failed to create scan run.");
    }
    scanRun = inserted;
  } catch (err) {
    const pgCode =
      (err as { code?: string; cause?: { code?: string } })?.code ??
      (err as { cause?: { code?: string } })?.cause?.code;
    if (pgCode === "23505") {
      // Either duplicate idempotencyKey raced or another scan is currently running
      const [racedByKey] = await db
        .select()
        .from(scanRuns)
        .where(eq(scanRuns.idempotencyKey, params.idempotencyKey))
        .limit(1);
      if (racedByKey) {
        return { scanRun: racedByKey, deduplicated: true, warnings: [] as string[] };
      }
      throw new ScanConflictError(
        "A scan is already running for this AWS connection. Please wait a moment.",
      );
    }
    throw err;
  }

  try {
    const savedRules = await db
      .select()
      .from(projectRules)
      .where(eq(projectRules.connectionId, conn.id));

    const ruleInputs: ProjectRuleInput[] = savedRules.map((r) => ({
      ruleType: r.ruleType,
      pattern: r.pattern,
      projectSlug: r.projectSlug,
      projectLabel: r.projectLabel,
      priority: r.priority,
    }));

    let warnings: string[] = [];
    let discovered;

    if (conn.mode === "demo") {
      discovered = getDemoAwsResources();
    } else {
      const creds = resolveAwsCredentialsFromConnection(conn);
      const live = await scanLiveAwsAccount(conn.regions, creds);
      discovered = live.resources;
      warnings = live.warnings;
    }

    const priced: PricedResourceSnapshot[] = groupAndPriceResources(discovered, ruleInputs);
    const findings: ComputedRuleFinding[] = evaluateZombieRules(priced);

    const totalMonthlyCents = priced.reduce((sum, r) => sum + r.monthlyCents, 0);
    // Cap per-resource savings at the resource's cost unless it's a stopped-RDS future restart alert
    const potentialSavingsCents = findings.reduce(
      (sum, f) => sum + f.estimatedMonthlySavingsCents,
      0,
    );

    const completed = await db.transaction(async (tx) => {
      if (priced.length > 0) {
        await tx.insert(awsResources).values(
          priced.map((r) => ({
            scanRunId: scanRun.id,
            connectionId: conn.id,
            arn: r.arn,
            resourceId: r.resourceId,
            service: r.service,
            region: r.region,
            name: r.name,
            state: r.state,
            projectSlug: r.projectSlug,
            projectLabel: r.projectLabel,
            projectSource: r.projectSource,
            hourlyMicrocents: r.hourlyMicrocents,
            monthlyCents: r.monthlyCents,
            tagsJson: r.tags,
            metadataJson: r.metadata,
          })),
        );
      }

      if (findings.length > 0) {
        await tx.insert(ruleFindings).values(
          findings.map((f) => ({
            scanRunId: scanRun.id,
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
          })),
        );
      }

      const [updated] = await tx
        .update(scanRuns)
        .set({
          status: "completed",
          resourceCount: priced.length,
          totalMonthlyCents,
          potentialSavingsCents,
          completedAt: new Date(),
        })
        .where(eq(scanRuns.id, scanRun.id))
        .returning();

      return updated ?? scanRun;
    });

    return { scanRun: completed, deduplicated: false, warnings };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown scan error.";
    await db
      .update(scanRuns)
      .set({
        status: "failed",
        errorMessage: message,
        completedAt: new Date(),
      })
      .where(eq(scanRuns.id, scanRun.id));
    throw err;
  }
}

export interface ProjectSummaryDto {
  slug: string;
  label: string;
  isOrphaned: boolean;
  resourceCount: number;
  monthlyCents: number;
  potentialSavingsCents: number;
  findingCount: number;
  criticalCount: number;
  services: AwsService[];
}

export interface DashboardPayload {
  connection: {
    id: string;
    name: string;
    mode: "demo" | "iam_keys" | "env_default";
    regions: string[];
    costExplorerEnabled: boolean;
  };
  latestScan: {
    id: string;
    status: "running" | "completed" | "failed";
    resourceCount: number;
    totalMonthlyCents: number;
    potentialSavingsCents: number;
    completedAt: string | null;
    startedAt: string;
  } | null;
  projects: ProjectSummaryDto[];
  urgentAlerts: Array<{
    id: string;
    projectSlug: string;
    resourceId: string;
    ruleCode: RuleCode;
    severity: Severity;
    title: string;
    description: string;
    estimatedMonthlySavingsCents: number;
    cliCommand: string;
  }>;
  findings: Array<{
    id: string;
    resourceId: string;
    resourceArn: string;
    projectSlug: string;
    ruleCode: RuleCode;
    severity: Severity;
    title: string;
    description: string;
    estimatedMonthlySavingsCents: number;
    cliCommand: string;
    terraformHint: string;
    keepsAppLive: boolean;
  }>;
  resources: Array<{
    id: string;
    arn: string;
    resourceId: string;
    service: AwsService;
    region: string;
    name: string;
    state: string;
    projectSlug: string;
    projectLabel: string;
    projectSource: "override" | "tag" | "prefix" | "parent" | "orphaned";
    hourlyMicrocents: number;
    monthlyCents: number;
    tags: Record<string, string>;
    metadata: Record<string, unknown>;
  }>;
  costExplorer: {
    actualMtdCents: number;
    periodStart: string;
    periodEnd: string;
    syncedAt: string;
  } | null;
  aiStatus: {
    geminiConfigured: boolean;
    groqConfigured: boolean;
    defaultProvider: "gemini" | "groq" | "auto";
  };
}

export async function getDashboardData(autoSeedDemo = true): Promise<DashboardPayload> {
  const db = await ensureDbReady();
  const conn = await getOrCreatePrimaryConnection();

  let [latestScan] = await db
    .select()
    .from(scanRuns)
    .where(and(eq(scanRuns.connectionId, conn.id), eq(scanRuns.status, "completed")))
    .orderBy(desc(scanRuns.completedAt))
    .limit(1);

  // Zero-config recruiter & first-run experience: auto-populate Demo Mode on first visit.
  if (!latestScan && autoSeedDemo && conn.mode === "demo") {
    try {
      const seeded = await triggerScan({
        connectionId: conn.id,
        idempotencyKey: `initial-demo-seed-${conn.id}`,
      });
      latestScan = seeded.scanRun;
    } catch {
      // Another concurrent first visit may already be seeding
      const [retryScan] = await db
        .select()
        .from(scanRuns)
        .where(and(eq(scanRuns.connectionId, conn.id), eq(scanRuns.status, "completed")))
        .orderBy(desc(scanRuns.completedAt))
        .limit(1);
      latestScan = retryScan;
    }
  }

  const [resources, findings, ceRows, aiRows] = await Promise.all([
    latestScan
      ? db
          .select()
          .from(awsResources)
          .where(eq(awsResources.scanRunId, latestScan.id))
          .limit(500)
      : Promise.resolve([]),
    latestScan
      ? db
          .select()
          .from(ruleFindings)
          .where(eq(ruleFindings.scanRunId, latestScan.id))
          .limit(500)
      : Promise.resolve([]),
    db
      .select()
      .from(costExplorerSyncs)
      .where(eq(costExplorerSyncs.connectionId, conn.id))
      .orderBy(desc(costExplorerSyncs.syncedAt))
      .limit(1),
    db.select().from(aiProviderConfigs),
  ]);

  const bucketMap = new Map<
    string,
    {
      slug: string;
      label: string;
      resourceCount: number;
      monthlyCents: number;
      potentialSavingsCents: number;
      findingCount: number;
      criticalCount: number;
      services: Set<AwsService>;
    }
  >();

  for (const r of resources) {
    const existing = bucketMap.get(r.projectSlug) ?? {
      slug: r.projectSlug,
      label:
        r.projectSlug === ORPHANED_PROJECT_SLUG ? ORPHANED_PROJECT_LABEL : r.projectLabel,
      resourceCount: 0,
      monthlyCents: 0,
      potentialSavingsCents: 0,
      findingCount: 0,
      criticalCount: 0,
      services: new Set<AwsService>(),
    };
    existing.resourceCount += 1;
    existing.monthlyCents += r.monthlyCents;
    existing.services.add(r.service);
    bucketMap.set(r.projectSlug, existing);
  }

  for (const f of findings) {
    const existing = bucketMap.get(f.projectSlug);
    if (existing) {
      existing.findingCount += 1;
      existing.potentialSavingsCents += f.estimatedMonthlySavingsCents;
      if (f.severity === "critical") existing.criticalCount += 1;
    }
  }

  const projects: ProjectSummaryDto[] = [...bucketMap.values()]
    .map((b) => ({
      slug: b.slug,
      label: b.label,
      isOrphaned: b.slug === ORPHANED_PROJECT_SLUG,
      resourceCount: b.resourceCount,
      monthlyCents: b.monthlyCents,
      potentialSavingsCents: b.potentialSavingsCents,
      findingCount: b.findingCount,
      criticalCount: b.criticalCount,
      services: [...b.services],
    }))
    .sort((a, b) => {
      if (a.isOrphaned && !b.isOrphaned) return -1;
      if (!a.isOrphaned && b.isOrphaned) return 1;
      return b.monthlyCents - a.monthlyCents;
    });

  const urgentAlerts = findings
    .filter(
      (f) =>
        f.severity === "critical" ||
        f.ruleCode === "RDS_7DAY_AUTORESTART" ||
        f.ruleCode === "UNATTACHED_EIP" ||
        f.ruleCode === "ORPHANED_EBS",
    )
    .sort((a, b) => b.estimatedMonthlySavingsCents - a.estimatedMonthlySavingsCents)
    .slice(0, 6)
    .map((f) => ({
      id: f.id,
      projectSlug: f.projectSlug,
      resourceId: f.resourceId,
      ruleCode: f.ruleCode,
      severity: f.severity,
      title: f.title,
      description: f.description,
      estimatedMonthlySavingsCents: f.estimatedMonthlySavingsCents,
      cliCommand: f.cliCommand,
    }));

  const geminiRow = aiRows.find((r) => r.provider === "gemini");
  const groqRow = aiRows.find((r) => r.provider === "groq");
  const geminiConfigured = Boolean(geminiRow?.encryptedApiKey || process.env.GEMINI_API_KEY);
  const groqConfigured = Boolean(groqRow?.encryptedApiKey || process.env.GROQ_API_KEY);

  let defaultProvider: "gemini" | "groq" | "auto" = "auto";
  if (geminiRow?.isDefault) defaultProvider = "gemini";
  else if (groqRow?.isDefault) defaultProvider = "groq";

  const latestCe = ceRows[0];

  return {
    connection: {
      id: conn.id,
      name: conn.name,
      mode: conn.mode,
      regions: conn.regions,
      costExplorerEnabled: conn.costExplorerEnabled,
    },
    latestScan: latestScan
      ? {
          id: latestScan.id,
          status: latestScan.status,
          resourceCount: latestScan.resourceCount,
          totalMonthlyCents: latestScan.totalMonthlyCents,
          potentialSavingsCents: latestScan.potentialSavingsCents,
          completedAt: latestScan.completedAt?.toISOString() ?? null,
          startedAt: latestScan.startedAt.toISOString(),
        }
      : null,
    projects,
    urgentAlerts,
    findings: findings.map((f) => ({
      id: f.id,
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
    })),
    resources: resources.map((r) => ({
      id: r.id,
      arn: r.arn,
      resourceId: r.resourceId,
      service: r.service,
      region: r.region,
      name: r.name,
      state: r.state,
      projectSlug: r.projectSlug,
      projectLabel: r.projectLabel,
      projectSource: r.projectSource,
      hourlyMicrocents: r.hourlyMicrocents,
      monthlyCents: r.monthlyCents,
      tags: r.tagsJson,
      metadata: r.metadataJson,
    })),
    costExplorer: latestCe
      ? {
          actualMtdCents: latestCe.actualMtdCents,
          periodStart: latestCe.periodStart,
          periodEnd: latestCe.periodEnd,
          syncedAt: latestCe.syncedAt.toISOString(),
        }
      : null,
    aiStatus: {
      geminiConfigured,
      groqConfigured,
      defaultProvider,
    },
  };
}
