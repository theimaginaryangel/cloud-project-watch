import { and, asc, desc, eq, lt } from "drizzle-orm";
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
import {
  buildStatelessDemoDashboard,
  getDemoAwsResources,
} from "@/lib/aws/demo-provider";
import { scanLiveAwsAccount, type AwsClientCredentials } from "@/lib/aws/scanner";
import { tryDecryptSecret } from "@/lib/crypto";
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
import { evaluateCostRules } from "@/lib/rules/cost-rules";
import {
  AppError,
  assertAmbientAwsAllowed,
  isAmbientAwsAllowed,
  isStatelessDemoMode,
  sanitizeErrorMessage,
} from "@/lib/security/guards";

export const STALE_SCAN_TIMEOUT_MS = 3 * 60 * 1000;
const MAX_SNAPSHOT_QUERY_ROWS = 10_000;

export interface StoredAwsCredsPayload {
  accessKeyId: string;
  secretAccessKey: string;
}

export class ScanConflictError extends AppError {
  constructor(message: string) {
    super(message, 409);
    this.name = "ScanConflictError";
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

export interface DashboardResourceDto {
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
}

export interface DashboardFindingDto {
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
  findings: DashboardFindingDto[];
  resources: DashboardResourceDto[];
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

/**
 * Computes total savings across findings while capping non-stopped per-resource
 * rule savings at that resource's actual monthly cost so savings never exceed 100%.
 */
export function computeCappedPotentialSavingsCents(
  resources: Array<{ resourceId: string; monthlyCents: number }>,
  findings: Array<{
    resourceId: string;
    ruleCode: RuleCode;
    estimatedMonthlySavingsCents: number;
  }>,
): number {
  const costByResource = new Map<string, number>();
  for (const r of resources) {
    costByResource.set(r.resourceId, r.monthlyCents);
  }

  const liveSavingsByResource = new Map<string, number>();
  let futureRestartSavingsCents = 0;

  for (const f of findings) {
    if (f.ruleCode === "RDS_7DAY_AUTORESTART") {
      futureRestartSavingsCents += f.estimatedMonthlySavingsCents;
      continue;
    }
    liveSavingsByResource.set(
      f.resourceId,
      (liveSavingsByResource.get(f.resourceId) ?? 0) + f.estimatedMonthlySavingsCents,
    );
  }

  let cappedLiveTotal = 0;
  for (const [resourceId, rawSavings] of liveSavingsByResource) {
    const resourceCost = costByResource.get(resourceId);
    cappedLiveTotal +=
      resourceCost !== undefined ? Math.min(rawSavings, resourceCost) : rawSavings;
  }

  return cappedLiveTotal + futureRestartSavingsCents;
}

export function aggregateScanSnapshot(
  resources: DashboardResourceDto[],
  findings: DashboardFindingDto[],
): {
  projects: ProjectSummaryDto[];
  urgentAlerts: DashboardPayload["urgentAlerts"];
  totalMonthlyCents: number;
  potentialSavingsCents: number;
} {
  const bucketMap = new Map<
    string,
    {
      slug: string;
      label: string;
      resources: Array<{ resourceId: string; monthlyCents: number }>;
      findings: Array<{
        resourceId: string;
        ruleCode: RuleCode;
        estimatedMonthlySavingsCents: number;
      }>;
      monthlyCents: number;
      criticalCount: number;
      services: Set<AwsService>;
    }
  >();

  let totalMonthlyCents = 0;

  for (const r of resources) {
    totalMonthlyCents += r.monthlyCents;
    const existing = bucketMap.get(r.projectSlug) ?? {
      slug: r.projectSlug,
      label:
        r.projectSlug === ORPHANED_PROJECT_SLUG ? ORPHANED_PROJECT_LABEL : r.projectLabel,
      resources: [],
      findings: [],
      monthlyCents: 0,
      criticalCount: 0,
      services: new Set<AwsService>(),
    };
    existing.resources.push({ resourceId: r.resourceId, monthlyCents: r.monthlyCents });
    existing.monthlyCents += r.monthlyCents;
    existing.services.add(r.service);
    bucketMap.set(r.projectSlug, existing);
  }

  for (const f of findings) {
    const existing = bucketMap.get(f.projectSlug);
    if (existing) {
      existing.findings.push({
        resourceId: f.resourceId,
        ruleCode: f.ruleCode,
        estimatedMonthlySavingsCents: f.estimatedMonthlySavingsCents,
      });
      if (f.severity === "critical") existing.criticalCount += 1;
    }
  }

  const projects: ProjectSummaryDto[] = [...bucketMap.values()]
    .map((b) => ({
      slug: b.slug,
      label: b.label,
      isOrphaned: b.slug === ORPHANED_PROJECT_SLUG,
      resourceCount: b.resources.length,
      monthlyCents: b.monthlyCents,
      potentialSavingsCents: computeCappedPotentialSavingsCents(b.resources, b.findings),
      findingCount: b.findings.length,
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

  const potentialSavingsCents = computeCappedPotentialSavingsCents(resources, findings);

  return {
    projects,
    urgentAlerts,
    totalMonthlyCents,
    potentialSavingsCents,
  };
}

export async function getOrCreatePrimaryConnection() {
  const db = await ensureDbReady();
  const [existing] = await db
    .select()
    .from(awsConnections)
    .orderBy(asc(awsConnections.createdAt))
    .limit(1);

  if (existing) return existing;

  const dbUrl = process.env.DATABASE_URL?.trim() ?? "";
  const isRemotePostgres =
    dbUrl.startsWith("postgres://") || dbUrl.startsWith("postgresql://");
  const explicitDemo = process.env.DEMO_MODE?.trim().toLowerCase();
  const useDemo =
    explicitDemo === "true" || (explicitDemo !== "false" && !isRemotePostgres);
  const hasAmbientEnvAws =
    isAmbientAwsAllowed() &&
    Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
  const mode = useDemo ? "demo" : hasAmbientEnvAws ? "env_default" : "iam_keys";

  await db
    .insert(awsConnections)
    .values({
      singletonKey: "primary",
      name: mode === "demo" ? "Demo AWS" : "Primary AWS",
      mode,
      regions: ["us-east-1", "us-east-2", "us-west-2"],
      costExplorerEnabled: false,
    })
    .onConflictDoNothing({ target: awsConnections.singletonKey });

  const [resolved] = await db
    .select()
    .from(awsConnections)
    .orderBy(asc(awsConnections.createdAt))
    .limit(1);

  if (!resolved) {
    throw new AppError("Failed to initialize AWS connection.", 500);
  }

  return resolved;
}

export function resolveAwsCredentialsFromConnection(conn: {
  mode: "demo" | "iam_keys" | "env_default";
  encryptedCredentials: string | null;
}): AwsClientCredentials | undefined {
  if (conn.mode === "demo") {
    return undefined;
  }

  if (conn.mode === "env_default") {
    assertAmbientAwsAllowed();
    return undefined;
  }

  if (!conn.encryptedCredentials) {
    throw new AppError(
      "AWS IAM keys are not saved yet. Add read-only IAM keys in Settings.",
      400,
    );
  }

  const decrypted = tryDecryptSecret(conn.encryptedCredentials);
  if (!decrypted) {
    throw new AppError(
      "Saved AWS IAM credentials could not be decrypted (APP_ENCRYPTION_KEY may have changed). Re-enter your IAM keys in Settings.",
      400,
    );
  }

  const parsed = JSON.parse(decrypted) as StoredAwsCredsPayload;
  return {
    accessKeyId: parsed.accessKeyId,
    secretAccessKey: parsed.secretAccessKey,
  };
}

export async function triggerScan(params: {
  connectionId?: string;
  idempotencyKey: string;
  now?: Date;
}) {
  if (isStatelessDemoMode()) {
    const demo = buildStatelessDemoDashboard();
    return {
      scanRun: {
        id: demo.latestScan?.id ?? "stateless-demo-scan",
        connectionId: demo.connection.id,
        idempotencyKey: params.idempotencyKey,
        status: "completed" as const,
        regionsScanned: demo.connection.regions,
        resourceCount: demo.latestScan?.resourceCount ?? 0,
        totalMonthlyCents: demo.latestScan?.totalMonthlyCents ?? 0,
        potentialSavingsCents: demo.latestScan?.potentialSavingsCents ?? 0,
        errorMessage: null,
        startedAt: new Date(),
        completedAt: new Date(),
      },
      deduplicated: false,
      warnings: [] as string[],
    };
  }

  const db = await ensureDbReady();
  const now = params.now ?? new Date();
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
    throw new AppError("AWS connection not found.", 404);
  }

  const [existingByKey] = await db
    .select()
    .from(scanRuns)
    .where(eq(scanRuns.idempotencyKey, params.idempotencyKey))
    .limit(1);

  if (existingByKey) {
    return { scanRun: existingByKey, deduplicated: true, warnings: [] as string[] };
  }

  // Expire orphaned/crashed 'running' scans older than STALE_SCAN_TIMEOUT_MS so a
  // process crash or serverless timeout can never permanently deadlock future scans.
  await db
    .update(scanRuns)
    .set({
      status: "failed",
      errorMessage: "Scan timed out before completion.",
      completedAt: now,
    })
    .where(
      and(
        eq(scanRuns.connectionId, conn.id),
        eq(scanRuns.status, "running"),
        lt(scanRuns.startedAt, new Date(now.getTime() - STALE_SCAN_TIMEOUT_MS)),
      ),
    );

  let scanRun: typeof scanRuns.$inferSelect;
  try {
    const [inserted] = await db
      .insert(scanRuns)
      .values({
        connectionId: conn.id,
        idempotencyKey: params.idempotencyKey,
        status: "running",
        regionsScanned: conn.regions,
        startedAt: now,
      })
      .returning();

    if (!inserted) {
      throw new AppError("Failed to create scan run.", 500);
    }
    scanRun = inserted;
  } catch (err) {
    const pgCode =
      (err as { code?: string; cause?: { code?: string } })?.code ??
      (err as { cause?: { code?: string } })?.cause?.code;
    if (pgCode === "23505") {
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
      discovered = getDemoAwsResources(now);
    } else {
      const creds = resolveAwsCredentialsFromConnection(conn);
      const live = await scanLiveAwsAccount(conn.regions, creds);
      discovered = live.resources;
      warnings = live.warnings;
    }

    const priced: PricedResourceSnapshot[] = groupAndPriceResources(discovered, ruleInputs);
    const findings: ComputedRuleFinding[] = evaluateCostRules(priced, now);

    const totalMonthlyCents = priced.reduce((sum, r) => sum + r.monthlyCents, 0);
    const potentialSavingsCents = computeCappedPotentialSavingsCents(priced, findings);

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
    const safeError = sanitizeErrorMessage(err, "Scan failed.").message;
    await db
      .update(scanRuns)
      .set({
        status: "failed",
        errorMessage: safeError,
        completedAt: new Date(),
      })
      .where(eq(scanRuns.id, scanRun.id))
      .catch(() => undefined);
    throw err;
  }
}

async function resolveLatestScanRun(
  conn: typeof awsConnections.$inferSelect,
  autoSeedDemo: boolean,
) {
  const db = await ensureDbReady();
  let [latestScan] = await db
    .select()
    .from(scanRuns)
    .where(and(eq(scanRuns.connectionId, conn.id), eq(scanRuns.status, "completed")))
    .orderBy(desc(scanRuns.completedAt))
    .limit(1);

  if (!latestScan && autoSeedDemo && conn.mode === "demo") {
    try {
      const seeded = await triggerScan({
        connectionId: conn.id,
        idempotencyKey: `initial-demo-seed-${conn.id}`,
      });
      latestScan = seeded.scanRun;
    } catch (err) {
      if (!(err instanceof ScanConflictError)) {
        throw err;
      }
      const [retryScan] = await db
        .select()
        .from(scanRuns)
        .where(and(eq(scanRuns.connectionId, conn.id), eq(scanRuns.status, "completed")))
        .orderBy(desc(scanRuns.completedAt))
        .limit(1);
      latestScan = retryScan;
    }
  }

  return latestScan ?? null;
}

function mapAiStatus(aiRows: Array<typeof aiProviderConfigs.$inferSelect>) {
  const geminiRow = aiRows.find((r) => r.provider === "gemini");
  const groqRow = aiRows.find((r) => r.provider === "groq");
  const geminiConfigured = Boolean(
    tryDecryptSecret(geminiRow?.encryptedApiKey) || process.env.GEMINI_API_KEY?.trim(),
  );
  const groqConfigured = Boolean(
    tryDecryptSecret(groqRow?.encryptedApiKey) || process.env.GROQ_API_KEY?.trim(),
  );

  let defaultProvider: "gemini" | "groq" | "auto" = "auto";
  if (geminiRow?.isDefault) defaultProvider = "gemini";
  else if (groqRow?.isDefault) defaultProvider = "groq";

  return { geminiConfigured, groqConfigured, defaultProvider };
}

export async function getDashboardData(autoSeedDemo = true): Promise<DashboardPayload> {
  if (isStatelessDemoMode()) {
    return buildStatelessDemoDashboard();
  }

  const db = await ensureDbReady();
  const conn = await getOrCreatePrimaryConnection();
  const latestScan = await resolveLatestScanRun(conn, autoSeedDemo);

  const [resourceRows, findingRows, ceRows, aiRows] = await Promise.all([
    latestScan
      ? db
          .select()
          .from(awsResources)
          .where(eq(awsResources.scanRunId, latestScan.id))
          .orderBy(desc(awsResources.monthlyCents), asc(awsResources.arn))
          .limit(MAX_SNAPSHOT_QUERY_ROWS)
      : Promise.resolve([]),
    latestScan
      ? db
          .select()
          .from(ruleFindings)
          .where(eq(ruleFindings.scanRunId, latestScan.id))
          .orderBy(desc(ruleFindings.estimatedMonthlySavingsCents), asc(ruleFindings.resourceArn))
          .limit(MAX_SNAPSHOT_QUERY_ROWS)
      : Promise.resolve([]),
    db
      .select()
      .from(costExplorerSyncs)
      .where(
        and(
          eq(costExplorerSyncs.connectionId, conn.id),
          eq(costExplorerSyncs.status, "completed"),
        ),
      )
      .orderBy(desc(costExplorerSyncs.syncedAt))
      .limit(1),
    db.select().from(aiProviderConfigs),
  ]);

  const resources: DashboardResourceDto[] = resourceRows.map((r) => ({
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
  }));

  const findings: DashboardFindingDto[] = findingRows.map((f) => ({
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
  }));

  const { projects, urgentAlerts } = aggregateScanSnapshot(resources, findings);
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
    findings,
    resources,
    costExplorer: latestCe
      ? {
          actualMtdCents: latestCe.actualMtdCents,
          periodStart: latestCe.periodStart,
          periodEnd: latestCe.periodEnd,
          syncedAt: latestCe.syncedAt.toISOString(),
        }
      : null,
    aiStatus: mapAiStatus(aiRows),
  };
}

export async function getProjectDetailData(slug: string, autoSeedDemo = true) {
  if (isStatelessDemoMode()) {
    const data = buildStatelessDemoDashboard();
    const project = data.projects.find((p) => p.slug === slug);
    if (!project) return null;
    return {
      connection: data.connection,
      latestScan: data.latestScan,
      aiStatus: data.aiStatus,
      project,
      resources: data.resources.filter((r) => r.projectSlug === slug),
      findings: data.findings.filter((f) => f.projectSlug === slug),
    };
  }

  const db = await ensureDbReady();
  const conn = await getOrCreatePrimaryConnection();
  const latestScan = await resolveLatestScanRun(conn, autoSeedDemo);

  if (!latestScan) {
    return null;
  }

  const [resourceRows, findingRows, aiRows] = await Promise.all([
    db
      .select()
      .from(awsResources)
      .where(
        and(eq(awsResources.scanRunId, latestScan.id), eq(awsResources.projectSlug, slug)),
      )
      .orderBy(desc(awsResources.monthlyCents), asc(awsResources.arn))
      .limit(MAX_SNAPSHOT_QUERY_ROWS),
    db
      .select()
      .from(ruleFindings)
      .where(
        and(eq(ruleFindings.scanRunId, latestScan.id), eq(ruleFindings.projectSlug, slug)),
      )
      .orderBy(desc(ruleFindings.estimatedMonthlySavingsCents), asc(ruleFindings.resourceArn))
      .limit(MAX_SNAPSHOT_QUERY_ROWS),
    db.select().from(aiProviderConfigs),
  ]);

  if (resourceRows.length === 0) {
    return null;
  }

  const resources: DashboardResourceDto[] = resourceRows.map((r) => ({
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
  }));

  const findings: DashboardFindingDto[] = findingRows.map((f) => ({
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
  }));

  const { projects } = aggregateScanSnapshot(resources, findings);
  const project = projects[0];
  if (!project) return null;

  return {
    connection: {
      id: conn.id,
      name: conn.name,
      mode: conn.mode,
      regions: conn.regions,
      costExplorerEnabled: conn.costExplorerEnabled,
    },
    latestScan: {
      id: latestScan.id,
      status: latestScan.status,
      resourceCount: latestScan.resourceCount,
      totalMonthlyCents: latestScan.totalMonthlyCents,
      potentialSavingsCents: latestScan.potentialSavingsCents,
      completedAt: latestScan.completedAt?.toISOString() ?? null,
      startedAt: latestScan.startedAt.toISOString(),
    },
    aiStatus: mapAiStatus(aiRows),
    project,
    resources,
    findings,
  };
}
