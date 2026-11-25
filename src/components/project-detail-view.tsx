"use client";

import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Cpu,
  RefreshCw,
  Scissors,
  Sparkles,
  Terminal,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { AdvisorResponse } from "@/lib/ai/advisor";
import {
  SERVICE_LABELS,
  formatCentsUsd,
  type AiProviderPreference,
  type AwsService,
  type RuleCode,
  type Severity,
} from "@/lib/domain/types";
import { buildTerraformDefaultTags } from "@/lib/grouping/project-grouper";
import type { ProjectSummaryDto } from "@/lib/scans/orchestrator";

interface ProjectDetailPayload {
  connection: {
    id: string;
    mode: "demo" | "iam_keys" | "env_default";
  };
  aiStatus: {
    geminiConfigured: boolean;
    groqConfigured: boolean;
    defaultProvider: AiProviderPreference;
  };
  project: ProjectSummaryDto;
  resources: Array<{
    id: string;
    arn: string;
    resourceId: string;
    service: AwsService;
    region: string;
    name: string;
    state: string;
    projectSource: "override" | "tag" | "prefix" | "parent" | "orphaned";
    monthlyCents: number;
    tags: Record<string, string>;
    metadata: Record<string, unknown>;
  }>;
  findings: Array<{
    id: string;
    resourceId: string;
    ruleCode: RuleCode;
    severity: Severity;
    title: string;
    description: string;
    estimatedMonthlySavingsCents: number;
    cliCommand: string;
    terraformHint: string;
    keepsAppLive: boolean;
  }>;
}

const SOURCE_LABELS: Record<string, string> = {
  override: "Saved Override",
  tag: "AWS Tag",
  prefix: "Name Prefix",
  parent: "Attached Parent",
  orphaned: "Untagged",
};

export function ProjectDetailView({ slug }: { slug: string }) {
  const [data, setData] = useState<ProjectDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [provider, setProvider] = useState<AiProviderPreference>("auto");
  const [aiResult, setAiResult] = useState<AdvisorResponse | null>(null);
  const [advising, setAdvising] = useState(false);
  const adviseLockRef = useRef(false);

  const loadProject = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Project not found.");
      }
      const payload = (await res.json()) as ProjectDetailPayload;
      setData(payload);
      setProvider(payload.aiStatus.defaultProvider);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load project.");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

  async function handleGeneratePlan(forceRefresh = false) {
    if (adviseLockRef.current) return;
    adviseLockRef.current = true;
    setAdvising(true);

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/advise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, forceRefresh }),
      });

      const body = (await res.json().catch(() => ({}))) as AdvisorResponse & {
        error?: string;
      };

      if (!res.ok) {
        throw new Error(body.error ?? "Failed to generate surgical plan.");
      }

      setAiResult(body);
      if (body.usedFallback) {
        toast.info(`Primary AI hit an error — automatically fell back to ${body.provider.toUpperCase()}`);
      } else if (body.source === "cache") {
        toast.success("Loaded cached surgical plan ($0 token cost)");
      } else if (body.source === "demo") {
        toast.success("Loaded Demo surgical plan (add Gemini or Groq key in Settings for live AI)");
      } else {
        toast.success(`Generated fresh surgical plan via ${body.provider.toUpperCase()}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI advisor failed.");
    } finally {
      adviseLockRef.current = false;
      setAdvising(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col gap-4">
        <Button variant="ghost" size="sm" asChild className="w-fit">
          <Link href="/">
            <ArrowLeft data-icon="inline-start" />
            Back to Overview
          </Link>
        </Button>
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Project unavailable</AlertTitle>
          <AlertDescription>{error ?? "Could not load project."}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const tfDefaultTagsSnippet = buildTerraformDefaultTags(
    data.project.isOrphaned ? "my-project" : data.project.label,
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Button variant="ghost" size="sm" asChild className="w-fit -ml-2">
          <Link href="/">
            <ArrowLeft data-icon="inline-start" />
            Back to Overview
          </Link>
        </Button>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">
                {data.project.label}
              </h1>
              {data.project.isOrphaned ? (
                <Badge variant="destructive">Untagged / Orphaned</Badge>
              ) : (
                <Badge variant="secondary">{data.project.resourceCount} resources</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Surgical cost optimizations keep live demos online — no terraform destroy.
            </p>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">Monthly Burn</span>
              <span className="text-xl font-semibold font-mono tabular-money">
                {formatCentsUsd(data.project.monthlyCents)}
              </span>
            </div>
            <Separator orientation="vertical" className="h-9" />
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">Rule Savings</span>
              <span className="text-xl font-semibold font-mono tabular-money text-emerald-500">
                {formatCentsUsd(data.project.potentialSavingsCents)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Dual AI Surgical Advisor (Gemini + Groq) */}
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4" />
              <span>AI Surgical Cost-Cutting Advisor</span>
            </CardTitle>
            <CardDescription>
              Bring your own Gemini and/or Groq key. Results are cached by resource snapshot hash.
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup
              type="single"
              value={provider}
              onValueChange={(val) => {
                if (val === "auto" || val === "gemini" || val === "groq") {
                  setProvider(val);
                }
              }}
              variant="outline"
              size="sm"
            >
              <ToggleGroupItem value="auto">Auto</ToggleGroupItem>
              <ToggleGroupItem value="gemini">Gemini</ToggleGroupItem>
              <ToggleGroupItem value="groq">Groq</ToggleGroupItem>
            </ToggleGroup>

            <Button
              size="sm"
              onClick={() => void handleGeneratePlan(false)}
              disabled={advising}
              className="active:scale-[0.97]"
            >
              {advising ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Cpu data-icon="inline-start" />
              )}
              {advising ? "Analyzing..." : "Generate Surgical Plan"}
            </Button>

            {aiResult ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleGeneratePlan(true)}
                disabled={advising}
              >
                <RefreshCw data-icon="inline-start" />
                Refresh
              </Button>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {!aiResult ? (
            <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>
                Click <strong>Generate Surgical Plan</strong> to get a non-destructive playbook
                with exact AWS CLI and Terraform edits tailored to {data.project.label}.
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <Badge variant={data.aiStatus.geminiConfigured ? "default" : "outline"}>
                  Gemini {data.aiStatus.geminiConfigured ? "Ready" : "BYOK"}
                </Badge>
                <Badge variant={data.aiStatus.groqConfigured ? "default" : "outline"}>
                  Groq {data.aiStatus.groqConfigured ? "Ready" : "BYOK"}
                </Badge>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-secondary/50 p-4">
                <div className="flex flex-col gap-1 max-w-2xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="default">
                      {aiResult.provider.toUpperCase()} · {aiResult.modelId}
                    </Badge>
                    <Badge variant="secondary">
                      {aiResult.source === "cache"
                        ? "Cached ($0)"
                        : aiResult.source === "demo"
                          ? "Demo Preview"
                          : "Live AI"}
                    </Badge>
                    {aiResult.plan.keepsAppLive ? (
                      <Badge variant="outline" className="text-emerald-500">
                        <CheckCircle2 className="mr-1 size-3" />
                        Keeps App Live
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-sm leading-relaxed text-foreground">
                    {aiResult.plan.summary}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">Est. Plan Savings</div>
                  <div className="text-xl font-semibold font-mono tabular-money text-emerald-500">
                    {formatCentsUsd(aiResult.plan.totalEstimatedMonthlySavingsCents)}/mo
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                {aiResult.plan.actions.map((action, idx) => (
                  <Card key={`${action.targetResourceId}-${idx}`}>
                    <CardHeader className="pb-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex flex-col gap-1">
                          <CardTitle className="text-base">{action.title}</CardTitle>
                          <CardDescription>
                            Target:{" "}
                            <code className="font-mono text-xs">{action.targetResourceId}</code>
                          </CardDescription>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="secondary" className="font-mono tabular-money">
                            Save {formatCentsUsd(action.estimatedMonthlySavingsCents)}/mo
                          </Badge>
                          <Badge variant="outline">
                            {action.downtimeImpact.replace(/_/g, " ")}
                          </Badge>
                          <Badge variant="outline">{action.riskLevel} risk</Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                      <p className="text-sm text-muted-foreground">{action.explanation}</p>
                      <Tabs defaultValue="cli">
                        <TabsList>
                          <TabsTrigger value="cli">AWS CLI</TabsTrigger>
                          <TabsTrigger value="tf">Terraform</TabsTrigger>
                        </TabsList>
                        <TabsContent value="cli" className="mt-2">
                          <div className="flex flex-col gap-2 rounded-lg bg-muted p-3 sm:flex-row sm:items-center sm:justify-between min-w-0">
                            <pre className="min-w-0 flex-1 overflow-x-auto text-xs font-mono">
                              <code>{action.cliCommand}</code>
                            </pre>
                            <div className="shrink-0">
                              <CopyButton value={action.cliCommand} />
                            </div>
                          </div>
                        </TabsContent>
                        <TabsContent value="tf" className="mt-2">
                          <div className="flex flex-col gap-2 rounded-lg bg-muted p-3 sm:flex-row sm:items-start sm:justify-between min-w-0">
                            <pre className="min-w-0 flex-1 overflow-x-auto text-xs font-mono">
                              <code>{action.terraformSnippet}</code>
                            </pre>
                            <div className="shrink-0">
                              <CopyButton value={action.terraformSnippet} />
                            </div>
                          </div>
                        </TabsContent>
                      </Tabs>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Instant $0 Deterministic Rule Findings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scissors className="size-4" />
            <span>Instant Rule Engine Findings ($0)</span>
          </CardTitle>
          <CardDescription>
            Computed automatically on every scan without spending AI tokens
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {data.findings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No waste rules triggered for this project. Everything looks lean.
            </p>
          ) : (
            data.findings.map((finding) => (
              <div
                key={finding.id}
                className="flex flex-col gap-3 rounded-lg border border-border p-4"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={
                          finding.severity === "critical" || finding.severity === "high"
                            ? "destructive"
                            : "secondary"
                        }
                      >
                        {finding.severity}
                      </Badge>
                      <span className="font-medium text-sm">{finding.title}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{finding.description}</p>
                  </div>
                  {finding.estimatedMonthlySavingsCents > 0 ? (
                    <Badge variant="secondary" className="font-mono tabular-money shrink-0">
                      Save {formatCentsUsd(finding.estimatedMonthlySavingsCents)}/mo
                    </Badge>
                  ) : null}
                </div>

                <div className="flex flex-col gap-2 rounded-md bg-muted p-2.5 sm:flex-row sm:items-center sm:justify-between min-w-0">
                  <code className="min-w-0 flex-1 overflow-x-auto text-xs font-mono whitespace-nowrap">
                    {finding.cliCommand}
                  </code>
                  <div className="shrink-0">
                    <CopyButton value={finding.cliCommand} label="Copy CLI" />
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Live Resources Table */}
      <Card>
        <CardHeader>
          <CardTitle>Live Resources ({data.resources.length})</CardTitle>
          <CardDescription>
            Shows how TagWatch grouped each resource (AWS Tag, Attached Parent, Name Prefix, or
            Saved Override)
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Resource</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Region</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Matched Via</TableHead>
                <TableHead className="text-right">Est. Monthly</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.resources.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-sm">{r.name}</span>
                      <span className="text-xs font-mono text-muted-foreground">
                        {r.resourceId}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{SERVICE_LABELS[r.service]}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.region}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        r.state === "running" || r.state === "available" || r.state === "active"
                          ? "outline"
                          : "secondary"
                      }
                    >
                      {r.state}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {SOURCE_LABELS[r.projectSource] ?? r.projectSource}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-money font-medium">
                    {formatCentsUsd(r.monthlyCents)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Future-Proofing Terraform default_tags */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Terminal className="size-4" />
            <span>Keep Future Deploys Auto-Tagged (Terraform)</span>
          </CardTitle>
          <CardDescription>
            Add this 5-line block to your AWS provider so new resources always land in{" "}
            {data.project.isOrphaned ? "your project" : data.project.label} automatically
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 rounded-lg bg-muted p-3 sm:flex-row sm:items-start sm:justify-between">
            <pre className="overflow-x-auto text-xs font-mono">
              <code>{tfDefaultTagsSnippet}</code>
            </pre>
            <CopyButton value={tfDefaultTagsSnippet} label="Copy HCL" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
