"use client";

import { ArrowUpRight, Bell, ChevronRight, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  SERVICE_LABELS,
  formatCentsUsd,
  formatDailyBurnFromMonthlyCents,
} from "@/lib/domain/types";
import type { DashboardPayload } from "@/lib/scans/orchestrator";

export function DashboardView() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [noticeDismissed, setNoticeDismissed] = useState(false);

  const scanLockRef = useRef(false);

  const loadDashboard = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/dashboard", { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not load data.");
      }
      setData((await res.json()) as DashboardPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  async function handleScanNow() {
    if (scanLockRef.current) return;
    scanLockRef.current = true;
    setScanning(true);

    const idempotencyKey = `scan-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    try {
      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey }),
      });

      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Scan failed.");

      toast("AWS resources refreshed");
      await loadDashboard();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Scan failed.");
    } finally {
      scanLockRef.current = false;
      setScanning(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-10">
        <div className="flex items-end justify-between">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-11 w-48" />
          </div>
          <Skeleton className="h-9 w-28 rounded-full" />
        </div>
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load overview</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <span>{error ?? "Unexpected error."}</span>
          <div>
            <Button variant="outline" size="sm" onClick={() => void loadDashboard()}>
              Try again
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  const totalMonthlyCents = data.latestScan?.totalMonthlyCents ?? 0;
  const totalSavingsCents = data.latestScan?.potentialSavingsCents ?? 0;
  const orphanBucket = data.projects.find((p) => p.isOrphaned);
  const maxProjectCents = Math.max(1, ...data.projects.map((p) => p.monthlyCents));
  const lastScanned = data.latestScan?.completedAt
    ? new Date(data.latestScan.completedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Never";

  return (
    <div className="flex flex-col gap-10">
      {/* Subtle Frosted Notification Banner (dismissible, monochrome) */}
      {!noticeDismissed && (totalSavingsCents > 0 || (orphanBucket && orphanBucket.resourceCount > 0)) ? (
        <div className="glass-panel rounded-2xl px-5 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Bell className="size-4 text-muted-foreground shrink-0" />
            <p className="text-sm text-foreground truncate">
              <span className="font-medium tabular-money">
                {formatCentsUsd(totalSavingsCents)}/mo
              </span>{" "}
              <span className="text-muted-foreground">
                in possible savings
                {orphanBucket && orphanBucket.resourceCount > 0
                  ? ` and ${orphanBucket.resourceCount} untagged items`
                  : ""}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Link
              href="/zombies"
              className="text-xs font-medium text-foreground hover:opacity-75 transition-opacity"
            >
              Review
            </Link>
            <button
              type="button"
              onClick={() => setNoticeDismissed(true)}
              aria-label="Dismiss notification"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      ) : null}

      {/* Hero Summary */}
      <section className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              {data.connection.mode === "demo" ? "Demo account" : data.connection.name}
            </span>
            <span>·</span>
            <span>Updated {lastScanned}</span>
            <span>·</span>
            <span>{data.connection.regions.join(", ")}</span>
          </div>

          <div className="flex items-baseline gap-3">
            <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight tabular-money">
              {formatCentsUsd(totalMonthlyCents)}
            </h1>
            <span className="text-sm text-muted-foreground">/ month</span>
          </div>

          <p className="text-sm text-muted-foreground tabular-money">
            {formatDailyBurnFromMonthlyCents(totalMonthlyCents)} per day across{" "}
            {data.latestScan?.resourceCount ?? 0} running resources
            {data.costExplorer
              ? ` · Actual MTD ${formatCentsUsd(data.costExplorer.actualMtdCents)}`
              : ""}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            asChild
            className="rounded-full px-4 press-feedback"
          >
            <Link href="/settings">
              {data.connection.mode === "demo" ? "Connect AWS" : "Settings"}
            </Link>
          </Button>
          <Button
            size="sm"
            onClick={() => void handleScanNow()}
            disabled={scanning}
            className="rounded-full px-4 press-feedback"
          >
            {scanning ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RefreshCw data-icon="inline-start" />
            )}
            {scanning ? "Scanning" : "Scan AWS"}
          </Button>
        </div>
      </section>

      {/* Projects Grouped Glass List */}
      {data.projects.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No resources found</EmptyTitle>
            <EmptyDescription>
              Run a scan or connect your read-only AWS account in Settings.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              onClick={() => void handleScanNow()}
              disabled={scanning}
              className="rounded-full"
            >
              Scan AWS
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Projects
            </h2>
            <span className="text-xs text-muted-foreground">Monthly estimate</span>
          </div>

          <div className="glass-panel rounded-2xl overflow-hidden hairline-divide">
            {data.projects.map((project) => {
              const barPercent = Math.max(
                4,
                Math.round((project.monthlyCents / maxProjectCents) * 100),
              );
              const serviceSummary = project.services
                .slice(0, 4)
                .map((s) => SERVICE_LABELS[s])
                .join(", ");

              return (
                <Link
                  key={project.slug}
                  href={`/projects/${encodeURIComponent(project.slug)}`}
                  className="group flex items-center justify-between gap-6 px-6 py-5 transition-colors hover:bg-secondary/60"
                >
                  <div className="min-w-0 flex-1 flex flex-col gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="text-base font-medium text-foreground">
                        {project.label}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {project.resourceCount} item{project.resourceCount === 1 ? "" : "s"}
                      </span>
                    </div>

                    <p className="text-xs text-muted-foreground truncate">
                      {serviceSummary}
                    </p>

                    <div className="h-1 w-full max-w-xs rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full rounded-full bg-foreground/70"
                        style={{ width: `${barPercent}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right flex flex-col gap-0.5">
                      <span className="text-base font-semibold font-mono tabular-money">
                        {formatCentsUsd(project.monthlyCents)}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-money">
                        {project.potentialSavingsCents > 0
                          ? `Save ${formatCentsUsd(project.potentialSavingsCents)}`
                          : "No waste"}
                      </span>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Top Items to Check (Max 3, clean monochrome rows) */}
      {data.urgentAlerts.length > 0 ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Worth checking
            </h2>
            <Link
              href="/zombies"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              <span>View all</span>
              <ArrowUpRight className="size-3.5" />
            </Link>
          </div>

          <div className="glass-panel rounded-2xl overflow-hidden hairline-divide">
            {data.urgentAlerts.slice(0, 3).map((item) => (
              <Link
                key={item.id}
                href={`/projects/${encodeURIComponent(item.projectSlug)}`}
                className="flex items-center justify-between gap-6 px-6 py-4 transition-colors hover:bg-secondary/60"
              >
                <div className="min-w-0 flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-foreground truncate">
                    {item.title}
                  </span>
                  <span className="text-xs text-muted-foreground truncate">
                    {item.description}
                  </span>
                </div>
                {item.estimatedMonthlySavingsCents > 0 ? (
                  <span className="shrink-0 text-xs font-mono tabular-money text-muted-foreground">
                    -{formatCentsUsd(item.estimatedMonthlySavingsCents)}/mo
                  </span>
                ) : null}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
