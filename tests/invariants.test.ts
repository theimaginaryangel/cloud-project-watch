import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BOOTSTRAP_SQL } from "@/db/bootstrap";
import { awsConnections, scanRuns, setDbForTests } from "@/db/index";
import * as schema from "@/db/schema";
import { syncCostExplorerGuarded } from "@/lib/aws/cost-explorer";
import {
  ScanConflictError,
  getDashboardData,
  getOrCreatePrimaryConnection,
  triggerScan,
} from "@/lib/scans/orchestrator";

describe("Production DB invariants, concurrency & 24h Cost Explorer guard (Real Postgres)", () => {
  let pglite: PGlite;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(BOOTSTRAP_SQL);
    const db = drizzle(pglite, { schema });
    setDbForTests(db);
  }, 30_000);

  beforeEach(async () => {
    await pglite.exec(
      "TRUNCATE aws_connections, ai_provider_configs RESTART IDENTITY CASCADE;",
    );
  });

  afterAll(async () => {
    setDbForTests(null);
    await pglite.close();
  });

  it("enforces DB-level idempotency when the same scan key is fired 5 times concurrently", async () => {
    const conn = await getOrCreatePrimaryConnection();

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        triggerScan({
          connectionId: conn.id,
          idempotencyKey: "same-scan-click-12345",
        }).catch((err: unknown) => err),
      ),
    );

    const successes = results.filter(
      (r): r is Awaited<ReturnType<typeof triggerScan>> =>
        !(r instanceof Error),
    );
    expect(successes.length).toBeGreaterThanOrEqual(1);

    const rows = await pglite.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM scan_runs",
    );
    expect(Number(rows.rows[0]?.count)).toBe(1);
  });

  it("blocks a second concurrent scan with ScanConflictError via partial unique index", async () => {
    const conn = await getOrCreatePrimaryConnection();
    const db = drizzle(pglite, { schema });

    // Hold an active running scan row directly in Postgres
    await db.insert(scanRuns).values({
      connectionId: conn.id,
      idempotencyKey: "in-flight-scan-1",
      status: "running",
      regionsScanned: ["us-east-1"],
    });

    await expect(
      triggerScan({
        connectionId: conn.id,
        idempotencyKey: "competing-scan-2",
      }),
    ).rejects.toThrow(ScanConflictError);
  });

  it("rejects negative money at the Postgres CHECK constraint level", async () => {
    const conn = await getOrCreatePrimaryConnection();
    await expect(
      pglite.query(
        `INSERT INTO scan_runs (connection_id, idempotency_key, status, total_monthly_cents)
         VALUES ($1, 'neg-test', 'completed', -500)`,
        [conn.id],
      ),
    ).rejects.toThrow();
  });

  it("enforces max 1 Cost Explorer API call per 24h under 5 concurrent sync attempts", async () => {
    const conn = await getOrCreatePrimaryConnection();
    const db = drizzle(pglite, { schema });

    await db
      .update(awsConnections)
      .set({ costExplorerEnabled: true })
      .where(eq(awsConnections.id, conn.id));

    let awsApiCallCount = 0;
    const fixedNow = new Date("2026-11-25T10:00:00Z");

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        syncCostExplorerGuarded({
          connectionId: conn.id,
          now: fixedNow,
          fetcher: async () => {
            awsApiCallCount += 1;
            return {
              actualMtdCents: 41250,
              byService: { "Amazon RDS": 32000, "Amazon EC2": 9250 },
            };
          },
        }),
      ),
    );

    expect(awsApiCallCount).toBe(1);
    expect(results.filter((r) => r.source === "fresh")).toHaveLength(1);
    expect(results.filter((r) => r.source === "cached")).toHaveLength(4);

    // 25 hours later, a fresh sync IS allowed
    const nextDay = new Date(fixedNow.getTime() + 25 * 60 * 60 * 1000);
    const nextDayResult = await syncCostExplorerGuarded({
      connectionId: conn.id,
      now: nextDay,
      fetcher: async () => {
        awsApiCallCount += 1;
        return { actualMtdCents: 42000, byService: {} };
      },
    });
    expect(awsApiCallCount).toBe(2);
    expect(nextDayResult.source).toBe("fresh");
  });

  it("auto-seeds Demo Mode on first dashboard load with pinned Orphan bucket first", async () => {
    const data = await getDashboardData(true);
    expect(data.connection.mode).toBe("demo");
    expect(data.latestScan?.status).toBe("completed");
    expect(data.projects[0]?.isOrphaned).toBe(true);
    expect(data.projects.some((p) => p.slug === "cloudpress")).toBe(true);
    expect(data.urgentAlerts.length).toBeGreaterThan(0);
  });
});
