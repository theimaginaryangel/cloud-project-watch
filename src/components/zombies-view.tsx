"use client";

import { AlertTriangle, Flame, FolderPlus, Tag } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CopyButton } from "@/components/copy-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ORPHANED_PROJECT_SLUG,
  SERVICE_LABELS,
  formatCentsUsd,
} from "@/lib/domain/types";
import { buildTagResourcesCli } from "@/lib/grouping/project-grouper";
import type { DashboardPayload } from "@/lib/scans/orchestrator";

export function ZombiesView() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [assignTarget, setAssignTarget] = useState<{
    arn: string;
    name: string;
    region: string;
  } | null>(null);
  const [projectName, setProjectName] = useState("");
  const [savingRule, setSavingRule] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/dashboard", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load zombie inbox.");
      setData((await res.json()) as DashboardPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load zombie inbox.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleAssignSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!assignTarget || !projectName.trim() || savingRule) return;
    setSavingRule(true);

    try {
      const res = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ruleType: "arn_override",
          pattern: assignTarget.arn,
          projectLabel: projectName.trim(),
          rescanAfterSave: true,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to assign resource.");
      }

      toast.success(`Assigned ${assignTarget.name} to ${projectName.trim()}`);
      setAssignTarget(null);
      setProjectName("");
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save assignment.");
    } finally {
      setSavingRule(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-44 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>Could not load Zombie Inbox</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <span>{error ?? "Unexpected error."}</span>
          <div>
            <Button variant="outline" size="sm" onClick={() => void loadData()}>
              Try again
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  const orphanedResources = data.resources.filter(
    (r) => r.projectSlug === ORPHANED_PROJECT_SLUG,
  );
  const wasteFindings = data.findings.filter((f) => f.ruleCode !== "UNTAGGED_RESOURCE");
  const existingProjects = data.projects
    .filter((p) => !p.isOrphaned)
    .map((p) => p.label);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Flame className="size-5 text-destructive" />
          <span>Orphan & Zombie Inbox</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          Triage untagged resources from failed deploys or copy surgical cleanup commands.
        </p>
      </div>

      <Tabs defaultValue="orphans">
        <TabsList>
          <TabsTrigger value="orphans">
            Untagged / Orphaned ({orphanedResources.length})
          </TabsTrigger>
          <TabsTrigger value="findings">
            All Waste Alerts ({wasteFindings.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="orphans" className="mt-4 flex flex-col gap-3">
          {orphanedResources.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>Zero untagged resources</EmptyTitle>
                <EmptyDescription>
                  Every discovered AWS resource is cleanly assigned to a project bucket.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            orphanedResources.map((r) => {
              const tagCli = buildTagResourcesCli([r.arn], "my-project", r.region);
              return (
                <Card key={r.id}>
                  <CardHeader className="pb-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex flex-col gap-1">
                        <CardTitle className="text-base flex items-center gap-2">
                          <span>{r.name}</span>
                          <Badge variant="secondary">{SERVICE_LABELS[r.service]}</Badge>
                          <Badge variant="outline">{r.region}</Badge>
                        </CardTitle>
                        <CardDescription className="font-mono text-xs break-all">
                          {r.arn}
                        </CardDescription>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-base font-semibold font-mono tabular-money">
                          {formatCentsUsd(r.monthlyCents)}/mo
                        </div>
                        <div className="text-xs text-muted-foreground">{r.state}</div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          setAssignTarget({ arn: r.arn, name: r.name, region: r.region });
                          setProjectName(existingProjects[0] ?? "");
                        }}
                        className="active:scale-[0.97]"
                      >
                        <FolderPlus data-icon="inline-start" />
                        Assign to Project (Local)
                      </Button>
                      <CopyButton value={tagCli} label="Copy AWS Tag CLI" />
                    </div>
                    <div className="rounded-md bg-muted p-2.5 text-xs font-mono overflow-x-auto">
                      {tagCli}
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="findings" className="mt-4 flex flex-col gap-3">
          {wasteFindings.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No zombie waste detected</EmptyTitle>
                <EmptyDescription>
                  No unattached EIPs, orphaned EBS volumes, stopped RDS timers, or idle NAT
                  gateways were found.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            wasteFindings.map((f) => (
              <Card key={f.id}>
                <CardHeader className="pb-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={
                            f.severity === "critical" || f.severity === "high"
                              ? "destructive"
                              : "secondary"
                          }
                        >
                          {f.severity}
                        </Badge>
                        <CardTitle className="text-base">{f.title}</CardTitle>
                      </div>
                      <CardDescription>{f.description}</CardDescription>
                    </div>
                    {f.estimatedMonthlySavingsCents > 0 ? (
                      <Badge variant="secondary" className="font-mono tabular-money shrink-0">
                        Save {formatCentsUsd(f.estimatedMonthlySavingsCents)}/mo
                      </Badge>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  <div className="flex flex-col gap-2 rounded-md bg-muted p-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <code className="text-xs font-mono overflow-x-auto">
                      {f.cliCommand}
                    </code>
                    <CopyButton value={f.cliCommand} label="Copy CLI" />
                  </div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Tag className="size-3" />
                    <span>Terraform tip: {f.terraformHint}</span>
                  </p>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* Assign Resource Dialog */}
      <Dialog
        open={Boolean(assignTarget)}
        onOpenChange={(open) => {
          if (!open) setAssignTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Resource to a Project</DialogTitle>
            <DialogDescription>
              Saves a local TagWatch mapping rule for{" "}
              <strong className="font-mono">{assignTarget?.name}</strong> (strictly read-only —
              does not modify AWS).
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={(e) => void handleAssignSubmit(e)} className="flex flex-col gap-4">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="assign-project-name">Project Name</FieldLabel>
                <Input
                  id="assign-project-name"
                  placeholder="e.g. CloudPress, Kaluna, BankGuard"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  required
                />
                <FieldDescription>
                  Existing projects:{" "}
                  {existingProjects.length > 0 ? existingProjects.join(", ") : "None yet"}
                </FieldDescription>
              </Field>
            </FieldGroup>

            {assignTarget && projectName.trim() ? (
              <div className="flex flex-col gap-1.5 rounded-lg bg-muted p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">
                    Optional: permanently tag in AWS
                  </span>
                  <CopyButton
                    value={buildTagResourcesCli(
                      [assignTarget.arn],
                      projectName.trim(),
                      assignTarget.region,
                    )}
                    label="Copy CLI"
                  />
                </div>
                <code className="text-[11px] font-mono break-all text-muted-foreground">
                  {buildTagResourcesCli(
                    [assignTarget.arn],
                    projectName.trim(),
                    assignTarget.region,
                  )}
                </code>
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAssignTarget(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={savingRule || !projectName.trim()}>
                {savingRule ? <Spinner data-icon="inline-start" /> : null}
                Save & Regroup
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
