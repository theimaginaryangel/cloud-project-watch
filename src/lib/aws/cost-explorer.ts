import { CostExplorerClient, GetCostAndUsageCommand } from "@aws-sdk/client-cost-explorer";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { awsConnections, costExplorerSyncs, ensureDbReady } from "@/db";
import type { AwsClientCredentials } from "@/lib/aws/scanner";
import { parseUsdDecimalToCents } from "@/lib/pricing/aws-rates";
import { AppError } from "@/lib/security/guards";

export const COST_EXPLORER_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const STALE_PENDING_SYNC_MS = 2 * 60 * 1000;

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

const inFlightSyncs = new Map<string, Promise<CostExplorerSyncResult>>();

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
      const parsedCents = parseUsdDecimalToCents(amountStr);
      if (parsedCents > 0) {
        byService[serviceName] = (byService[serviceName] ?? 0) + parsedCents;
        totalCents += parsedCents;
      }
    }
  }

  return { actualMtdCents: totalCents, byService };
}

async function executeSyncWithPendingIntent(params: {
  connectionId: string;
  credentials?: AwsClientCredentials;
  now: Date;
  fetcher: CostExplorerFetcher;
}): Promise<CostExplorerSyncResult> {
  const db = await ensureDbReady();
  const { now, connectionId, fetcher } = params;
  const { periodStart, periodEnd } = currentMonthWindow(now);

  // Phase 1: Fast DB transaction (<5ms) claims a PENDING intent slot with zero network I/O.
  const claim = await db.transaction(
    async (
      tx,
    ): Promise<
      | { kind: "cached"; result: CostExplorerSyncResult }
      | { kind: "claimed"; pendingId: string }
    > => {
      const [conn] = await tx
        .select()
        .from(awsConnections)
        .where(eq(awsConnections.id, connectionId))
        .for("update");

      if (!conn) {
        throw new AppError("AWS connection not found.", 404);
      }

      if (!conn.costExplorerEnabled) {
        throw new AppError(
          "Cost Explorer sync is disabled. Enable the 24h-capped Cost Explorer option in Settings first.",
          400,
        );
      }

      await tx
        .update(costExplorerSyncs)
        .set({ status: "failed" })
        .where(
          and(
            eq(costExplorerSyncs.connectionId, connectionId),
            eq(costExplorerSyncs.status, "pending"),
            lt(costExplorerSyncs.syncedAt, new Date(now.getTime() - STALE_PENDING_SYNC_MS)),
          ),
        );

      const [latest] = await tx
        .select()
        .from(costExplorerSyncs)
        .where(
          and(
            eq(costExplorerSyncs.connectionId, connectionId),
            inArray(costExplorerSyncs.status, ["completed", "pending"]),
          ),
        )
        .orderBy(desc(costExplorerSyncs.syncedAt))
        .limit(1);

      if (latest) {
        if (latest.status === "pending") {
          throw new AppError(
            "A Cost Explorer sync is already in progress. Please wait a moment.",
            409,
          );
        }

        const ageMs = now.getTime() - latest.syncedAt.getTime();
        if (ageMs < COST_EXPLORER_COOLDOWN_MS) {
          return {
            kind: "cached",
            result: {
              source: "cached",
              periodStart: latest.periodStart,
              periodEnd: latest.periodEnd,
              actualMtdCents: latest.actualMtdCents,
              byService: latest.byServiceJson,
              syncedAt: latest.syncedAt.toISOString(),
              nextAllowedSyncAt: new Date(
                latest.syncedAt.getTime() + COST_EXPLORER_COOLDOWN_MS,
              ).toISOString(),
            },
          };
        }
      }

      const [pending] = await tx
        .insert(costExplorerSyncs)
        .values({
          connectionId,
          status: "pending",
          periodStart,
          periodEnd,
          actualMtdCents: 0,
          byServiceJson: {},
          syncedAt: now,
        })
        .returning();

      if (!pending) {
        throw new AppError("Failed to reserve Cost Explorer sync slot.", 500);
      }

      return { kind: "claimed", pendingId: pending.id };
    },
  );

  if (claim.kind === "cached") {
    return claim.result;
  }

  // Phase 2: External AWS HTTP call runs completely outside any DB lock/transaction.
  try {
    const fresh = await fetcher(periodStart, periodEnd, params.credentials);
    const safeCents = Math.max(0, Math.round(fresh.actualMtdCents));

    const [completed] = await db
      .update(costExplorerSyncs)
      .set({
        status: "completed",
        actualMtdCents: safeCents,
        byServiceJson: fresh.byService,
      })
      .where(eq(costExplorerSyncs.id, claim.pendingId))
      .returning();

    const syncedAt = completed?.syncedAt ?? now;
    return {
      source: "fresh",
      periodStart,
      periodEnd,
      actualMtdCents: completed?.actualMtdCents ?? safeCents,
      byService: completed?.byServiceJson ?? fresh.byService,
      syncedAt: syncedAt.toISOString(),
      nextAllowedSyncAt: new Date(syncedAt.getTime() + COST_EXPLORER_COOLDOWN_MS).toISOString(),
    };
  } catch (err) {
    await db
      .update(costExplorerSyncs)
      .set({ status: "failed" })
      .where(eq(costExplorerSyncs.id, claim.pendingId))
      .catch(() => undefined);
    throw err;
  }
}

/**
 * Enforces max 1 Cost Explorer call per 24 hours per connection using a short
 * transactional PENDING-intent reservation plus in-process request coalescing,
 * without holding database row locks open during external HTTP calls.
 */
export async function syncCostExplorerGuarded(params: {
  connectionId: string;
  credentials?: AwsClientCredentials;
  now?: Date;
  fetcher?: CostExplorerFetcher;
}): Promise<CostExplorerSyncResult> {
  const existingInFlight = inFlightSyncs.get(params.connectionId);
  if (existingInFlight) {
    const leaderResult = await existingInFlight;
    return { ...leaderResult, source: "cached" };
  }

  const now = params.now ?? new Date();
  const fetcher = params.fetcher ?? defaultCostExplorerFetcher;

  const syncPromise = executeSyncWithPendingIntent({
    connectionId: params.connectionId,
    credentials: params.credentials,
    now,
    fetcher,
  });

  inFlightSyncs.set(params.connectionId, syncPromise);
  try {
    return await syncPromise;
  } finally {
    if (inFlightSyncs.get(params.connectionId) === syncPromise) {
      inFlightSyncs.delete(params.connectionId);
    }
  }
}
