"use client";

import { ChevronDown, ExternalLink, FolderPlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CopyButton } from "@/components/copy-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { buildAwsConsoleUrl } from "@/lib/aws/console-links";
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
      if (!res.ok) throw new Error("Could not load resources.");
      setData((await res.json()) as DashboardPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load resources.");
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
        throw new Error(body.error ?? "Could not assign resource.");
      }

      toast(`Assigned ${assignTarget.name} to ${projectName.trim()}`);
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
      <div className="flex flex-col gap-6">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load untagged resources</AlertTitle>
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
  const resourceById = new Map(data.resources.map((r) => [r.resourceId, r]));
  const wasteFindings = data.findings.filter((f) => f.ruleCode !== "UNTAGGED_RESOURCE");
  const existingProjects = data.projects
    .filter((p) => !p.isOrphaned)
    .map((p) => p.label);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-3xl font-semibold tracking-tight">Untagged & idle</h1>
        <p className="text-sm text-muted-foreground">
          Group untagged resources into a project or open them directly in the AWS Console.
        </p>
      </div>

      <Tabs defaultValue="orphans">
        <TabsList>
          <TabsTrigger value="orphans">
            Untagged ({orphanedResources.length})
          </TabsTrigger>
          <TabsTrigger value="findings">
            All checks ({wasteFindings.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="orphans" className="mt-6">
          {orphanedResources.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No untagged resources</EmptyTitle>
                <EmptyDescription>
                  Every running resource in your last scan belongs to a project.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="glass-panel rounded-2xl overflow-hidden hairline-divide">
              {orphanedResources.map((r) => {
                const tagCli = buildTagResourcesCli([r.arn], "my-project", r.region);
                const consoleUrl = buildAwsConsoleUrl(r.service, r.region, r.resourceId);

                return (
                  <details key={r.id} className="group">
                    <summary className="list-none cursor-pointer px-6 py-4 flex items-center justify-between gap-4 hover:bg-secondary/50 transition-colors">
                      <div className="min-w-0 flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">
                            {r.name}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {SERVICE_LABELS[r.service]}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground font-mono truncate">
                          {r.resourceId} · {r.region} · {r.state}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-sm font-mono tabular-money font-medium">
                          {formatCentsUsd(r.monthlyCents)}/mo
                        </span>
                        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
                      </div>
                    </summary>

                    <div className="px-6 pb-5 pt-1 flex flex-col gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => {
                            setAssignTarget({
                              arn: r.arn,
                              name: r.name,
                              region: r.region,
                            });
                            setProjectName(existingProjects[0] ?? "");
                          }}
                          className="rounded-full press-feedback"
                        >
                          <FolderPlus data-icon="inline-start" />
                          Assign to project
                        </Button>
                        <CopyButton value={tagCli} label="Copy tag command" />
                        <Button variant="ghost" size="sm" asChild>
                          <a
                            href={consoleUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Open in AWS Console
                            <ExternalLink data-icon="inline-end" />
                          </a>
                        </Button>
                      </div>

                      <div className="rounded-xl bg-secondary/70 p-3.5 text-xs font-mono break-all whitespace-pre-wrap text-muted-foreground">
                        {tagCli}
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="findings" className="mt-6">
          {wasteFindings.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No cost issues found</EmptyTitle>
                <EmptyDescription>
                  No unattached Elastic IPs, unused EBS volumes, stopped RDS timers, or idle NAT
                  gateways were detected.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="glass-panel rounded-2xl overflow-hidden hairline-divide">
              {wasteFindings.map((f) => {
                const matched = resourceById.get(f.resourceId);
                const consoleUrl = matched
                  ? buildAwsConsoleUrl(matched.service, matched.region, matched.resourceId)
                  : null;

                return (
                  <details key={f.id} className="group">
                    <summary className="list-none cursor-pointer px-6 py-4 flex items-center justify-between gap-4 hover:bg-secondary/50 transition-colors">
                      <div className="min-w-0 flex flex-col gap-0.5">
                        <span className="text-sm font-medium text-foreground">
                          {f.title}
                        </span>
                        <span className="text-xs text-muted-foreground truncate">
                          {f.description}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        {f.estimatedMonthlySavingsCents > 0 ? (
                          <span className="text-xs font-mono tabular-money text-muted-foreground">
                            -{formatCentsUsd(f.estimatedMonthlySavingsCents)}/mo
                          </span>
                        ) : null}
                        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
                      </div>
                    </summary>

                    <div className="px-6 pb-5 pt-1 flex flex-col gap-3">
                      <div className="rounded-xl bg-secondary/70 p-4 flex flex-col gap-3">
                        <code className="text-xs font-mono break-all whitespace-pre-wrap leading-relaxed">
                          {f.cliCommand}
                        </code>
                        <div className="flex flex-wrap items-center gap-2">
                          <CopyButton value={f.cliCommand} label="Copy command" />
                          {consoleUrl ? (
                            <Button variant="ghost" size="sm" asChild>
                              <a
                                href={consoleUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                Open in AWS Console
                                <ExternalLink data-icon="inline-end" />
                              </a>
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Terraform: {f.terraformHint}
                      </p>
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog
        open={Boolean(assignTarget)}
        onOpenChange={(open) => {
          if (!open) setAssignTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign to project</DialogTitle>
            <DialogDescription>
              Groups <span className="font-mono">{assignTarget?.name}</span> locally inside
              CloudProjectWatch without changing anything in AWS.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={(e) => void handleAssignSubmit(e)} className="flex flex-col gap-4">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="assign-project-name">Project name</FieldLabel>
                <Input
                  id="assign-project-name"
                  placeholder="CloudPress, Kaluna, BankGuard"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  required
                />
                <FieldDescription>
                  Existing: {existingProjects.length > 0 ? existingProjects.join(", ") : "None"}
                </FieldDescription>
              </Field>
            </FieldGroup>

            {assignTarget && projectName.trim() ? (
              <div className="rounded-xl bg-secondary/70 p-3.5 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    Optional command to tag in AWS
                  </span>
                  <CopyButton
                    value={buildTagResourcesCli(
                      [assignTarget.arn],
                      projectName.trim(),
                      assignTarget.region,
                    )}
                    label="Copy"
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
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
