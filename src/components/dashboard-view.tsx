"use client";

import {
  AlertTriangle,
  ArrowRight,
  Flame,
  RefreshCw,
  Scissors,
  Settings,
  ShieldAlert,
  TrendingDown,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CopyButton } from "@/components/copy-button";
import { ProjectBurnChart } from "@/components/project-burn-chart";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

  // Synchronous in-flight ref prevents rapid 20ms double-click duplicate scan calls
  const scanLockRef = useRef(false);

  const loadDashboard = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/dashboard", { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to load dashboard.");
      }
      const payload = (await res.json()) as DashboardPayload;
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard.");
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

      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        warnings?: string[];
      };

      if (!res.ok) {
        throw new Error(body.error ?? "Scan failed.");
      }

      toast.success("AWS snapshot updated using $0 Describe* APIs");
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
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-9 w-32" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>Unable to load TagWatch dashboard</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <span>{error ?? "Unexpected empty response."}</span>
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
  const zombieAlertCount = data.findings.length;
  const lastScannedLabel = data.latestScan?.completedAt
    ? new Date(data.latestScan.completedAt).toLocaleString()
    : "Never";

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Project Cost Radar</h1>
            <Badge variant={data.connection.mode === "demo" ? "secondary" : "default"}>
              {data.connection.mode === "demo" ? "Demo Mode" : "Live AWS (Read-Only)"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Last scanned: {lastScannedLabel} · Regions: {data.connection.regions.join(", ")}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild className="active:scale-[0.97]">
            <Link href="/settings">
              <Settings data-icon="inline-start" />
              {data.connection.mode === "demo" ? "Connect AWS" : "Settings"}
            </Link>
          </Button>
          <Button
            size="sm"
            onClick={() => void handleScanNow()}
            disabled={scanning}
            className="active:scale-[0.97]"
          >
            {scanning ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RefreshCw data-icon="inline-start" />
            )}
            {scanning ? "Scanning..." : "Scan Now ($0)"}
          </Button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Est. Monthly Burn</CardDescription>
            <CardTitle className="text-2xl font-mono tabular-money">
              {formatCentsUsd(totalMonthlyCents)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {data.latestScan?.resourceCount ?? 0} live billable resources
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Daily Burn Rate</CardDescription>
            <CardTitle className="text-2xl font-mono tabular-money">
              {formatDailyBurnFromMonthlyCents(totalMonthlyCents)}/day
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {data.costExplorer
              ? `Cost Explorer MTD: ${formatCentsUsd(data.costExplorer.actualMtdCents)}`
              : "Estimated from live Describe* rates"}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <Scissors className="size-3.5" />
              <span>Surgical Savings</span>
            </CardDescription>
            <CardTitle className="text-2xl font-mono tabular-money text-emerald-500">
              {formatCentsUsd(totalSavingsCents)}/mo
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Cut spend without running terraform destroy
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <Flame className="size-3.5" />
              <span>Zombie & Drift Alerts</span>
            </CardDescription>
            <CardTitle className="text-2xl font-mono tabular-money">
              {zombieAlertCount}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {orphanBucket
              ? `${orphanBucket.resourceCount} untagged/orphaned (${formatCentsUsd(orphanBucket.monthlyCents)}/mo)`
              : "Zero untagged resources"}
          </CardContent>
        </Card>
      </div>

      {/* Pinned Urgent Alerts Banner */}
      {data.urgentAlerts.length > 0 ? (
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertTitle>
            Immediate Cost Leaks Detected ({data.urgentAlerts.length} high-priority)
          </AlertTitle>
          <AlertDescription className="flex flex-col gap-3 pt-1">
            <div className="flex flex-col gap-2">
              {data.urgentAlerts.slice(0, 3).map((alert) => (
                <div
                  key={alert.id}
                  className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-background/70 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-foreground">
                      {alert.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {alert.description}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {alert.estimatedMonthlySavingsCents > 0 ? (
                      <Badge variant="secondary" className="font-mono tabular-money">
                        Save {formatCentsUsd(alert.estimatedMonthlySavingsCents)}/mo
                      </Badge>
                    ) : null}
                    <CopyButton value={alert.cliCommand} label="Copy CLI" />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" asChild>
                <Link href="/zombies">
                  Open Zombie Inbox
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Projects Section */}
      {data.projects.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No AWS resources discovered yet</EmptyTitle>
            <EmptyDescription>
              Run your first $0 Describe* scan or switch to Demo Mode in Settings to preview
              project cost tracking.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => void handleScanNow()} disabled={scanning}>
              Run First Scan
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <ProjectBurnChart projects={data.projects} />

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-tight">Projects</h2>
              <span className="text-xs text-muted-foreground">
                Click any project for live specs & Gemini/Groq surgical plan
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {data.projects.map((project, idx) => (
                <motion.div
                  key={project.slug}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: idx * 0.04 }}
                  whileTap={{ scale: 0.99 }}
                >
                  <Link
                    href={`/projects/${encodeURIComponent(project.slug)}`}
                    className="block h-full"
                  >
                    <Card
                      className={
                        project.isOrphaned
                          ? "h-full border-destructive/60 transition-colors hover:border-destructive"
                          : "h-full transition-colors hover:border-ring"
                      }
                    >
                      <CardHeader>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex flex-col gap-1">
                            <CardTitle className="flex items-center gap-2 text-base">
                              <span>{project.label}</span>
                              {project.isOrphaned ? (
                                <Badge variant="destructive">Needs Triage</Badge>
                              ) : null}
                            </CardTitle>
                            <CardDescription>
                              {project.resourceCount} resource
                              {project.resourceCount === 1 ? "" : "s"} ·{" "}
                              {project.findingCount} finding
                              {project.findingCount === 1 ? "" : "s"}
                            </CardDescription>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-semibold font-mono tabular-money">
                              {formatCentsUsd(project.monthlyCents)}
                            </div>
                            <div className="text-xs text-muted-foreground">/month</div>
                          </div>
                        </div>
                      </CardHeader>

                      <CardContent className="flex flex-wrap gap-1.5">
                        {project.services.map((svc) => (
                          <Badge key={svc} variant="secondary">
                            {SERVICE_LABELS[svc]}
                          </Badge>
                        ))}
                      </CardContent>

                      <CardFooter className="justify-between border-t border-border/60 pt-3">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-500 font-mono tabular-money">
                          <TrendingDown className="size-3.5" />
                          <span>
                            {project.potentialSavingsCents > 0
                              ? `Save ${formatCentsUsd(project.potentialSavingsCents)}/mo`
                              : "Running lean"}
                          </span>
                        </div>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          Inspect <ArrowRight className="size-3.5" />
                        </span>
                      </CardFooter>
                    </Card>
                  </Link>
                </motion.div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
