import { CostExplorerClient, GetCostAndUsageCommand } from "@aws-sdk/client-cost-explorer";
import { desc, eq } from "drizzle-orm";
import { awsConnections, costExplorerSyncs, ensureDbReady } from "@/db";
import type { AwsClientCredentials } from "@/lib/aws/scanner";

export const COST_EXPLORER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export interface CostExplorerSyncResult {
  source: "fresh" | "cached";
  periodStart: string;
  periodEnd: string;
  actualMtdCents: number;
  byService: Record<string, number>;
  syncedAt: string;
  nextAllowedSyncAt: string;
}

export type CostExplorerFetcher = (
  periodStart: string,
  periodEnd: string,
  credentials?: AwsClientCredentials,
) => Promise<{ actualMtdCents: number; byService: Record<string, number> }>;

function currentMonthWindow(now: Date): { periodStart: string; periodEnd: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return {
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
  };
}

export async function defaultCostExplorerFetcher(
  periodStart: string,
  periodEnd: string,
  credentials?: AwsClientCredentials,
): Promise<{ actualMtdCents: number; byService: Record<string, number> }> {
  const client = new CostExplorerClient({
    region: "us-east-1",
    ...(credentials ? { credentials } : {}),
  });

  const response = await client.send(
    new GetCostAndUsageCommand({
      TimePeriod: { Start: periodStart, End: periodEnd },
      Granularity: "MONTHLY",
      Metrics: ["UnblendedCost"],
      GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }],
    }),
    { abortSignal: AbortSignal.timeout(15_000) },
  );

  let totalCents = 0;
  const byService: Record<string, number> = {};

  for (const period of response.ResultsByTime ?? []) {
    for (const group of period.Groups ?? []) {
      const serviceName = group.Keys?.[0] ?? "Other";
      const amountStr = group.Metrics?.UnblendedCost?.Amount ?? "0";
      const parsedCents = Math.max(0, Math.round(Number(amountStr) * 100));
      if (parsedCents > 0) {
        byService[serviceName] = (byService[serviceName] ?? 0) + parsedCents;
        totalCents += parsedCents;
      }
    }
  }

  return { actualMtdCents: totalCents, byService };
}

/**
 * Strictly enforces max 1 Cost Explorer call per 24 hours per connection using a
 * Postgres row lock (SELECT ... FOR UPDATE) so concurrent requests cannot double-bill $0.01.
 */
export async function syncCostExplorerGuarded(params: {
  connectionId: string;
  credentials?: AwsClientCredentials;
  now?: Date;
  fetcher?: CostExplorerFetcher;
}): Promise<CostExplorerSyncResult> {
  const db = await ensureDbReady();
  const now = params.now ?? new Date();
  const fetcher = params.fetcher ?? defaultCostExplorerFetcher;

  return db.transaction(async (tx) => {
    const [conn] = await tx
      .select()
      .from(awsConnections)
      .where(eq(awsConnections.id, params.connectionId))
      .for("update");

    if (!conn) {
      throw new Error("AWS connection not found.");
    }

    if (!conn.costExplorerEnabled) {
      throw new Error(
        "Cost Explorer sync is disabled. Enable the 24h-capped Cost Explorer option in Settings first.",
      );
    }

    const [latest] = await tx
      .select()
      .from(costExplorerSyncs)
      .where(eq(costExplorerSyncs.connectionId, params.connectionId))
      .orderBy(desc(costExplorerSyncs.syncedAt))
      .limit(1);

    if (latest) {
      const ageMs = now.getTime() - latest.syncedAt.getTime();
      if (ageMs < COST_EXPLORER_COOLDOWN_MS) {
        return {
          source: "cached",
          periodStart: latest.periodStart,
          periodEnd: latest.periodEnd,
          actualMtdCents: latest.actualMtdCents,
          byService: latest.byServiceJson,
          syncedAt: latest.syncedAt.toISOString(),
          nextAllowedSyncAt: new Date(
            latest.syncedAt.getTime() + COST_EXPLORER_COOLDOWN_MS,
          ).toISOString(),
        };
      }
    }

    const { periodStart, periodEnd } = currentMonthWindow(now);
    const fresh = await fetcher(periodStart, periodEnd, params.credentials);

    const [inserted] = await tx
      .insert(costExplorerSyncs)
      .values({
        connectionId: params.connectionId,
        periodStart,
        periodEnd,
        actualMtdCents: Math.max(0, Math.round(fresh.actualMtdCents)),
        byServiceJson: fresh.byService,
        syncedAt: now,
      })
      .returning();

    if (!inserted) {
      throw new Error("Failed to persist Cost Explorer sync.");
    }

    return {
      source: "fresh",
      periodStart: inserted.periodStart,
      periodEnd: inserted.periodEnd,
      actualMtdCents: inserted.actualMtdCents,
      byService: inserted.byServiceJson,
      syncedAt: inserted.syncedAt.toISOString(),
      nextAllowedSyncAt: new Date(
        inserted.syncedAt.getTime() + COST_EXPLORER_COOLDOWN_MS,
      ).toISOString(),
    };
  });
}
