"use client";

import { ArrowLeft, ChevronDown, ExternalLink, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CopyButton } from "@/components/copy-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { AdvisorResponse } from "@/lib/ai/advisor";
import { buildAwsConsoleUrl } from "@/lib/aws/console-links";
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
  override: "Assigned",
  tag: "Tag",
  prefix: "Prefix",
  parent: "Attached",
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
      setError(err instanceof Error ? err.message : "Could not load project.");
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

      if (!res.ok) throw new Error(body.error ?? "Could not generate recommendations.");

      setAiResult(body);
      if (body.usedFallback) {
        toast(`Switched to ${body.provider.toUpperCase()} fallback`);
      } else if (body.source === "cache") {
        toast("Loaded cached recommendations");
      } else if (body.source === "demo") {
        toast("Showing demo recommendations (add a Gemini or Groq key in Settings for live runs)");
      } else {
        toast(`Updated via ${body.provider.toUpperCase()}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Request failed.");
    } finally {
      adviseLockRef.current = false;
      setAdvising(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-56 w-full rounded-2xl" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col gap-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground w-fit"
        >
          <ArrowLeft className="size-4" />
          <span>Overview</span>
        </Link>
        <Alert variant="destructive">
          <AlertTitle>Project unavailable</AlertTitle>
          <AlertDescription>{error ?? "Could not load project."}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const resourceById = new Map(data.resources.map((r) => [r.resourceId, r]));
  const tfDefaultTagsSnippet = buildTerraformDefaultTags(
    data.project.isOrphaned ? "my-project" : data.project.label,
  );

  return (
    <div className="flex flex-col gap-10">
      {/* Header */}
      <div className="flex flex-col gap-5">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit"
        >
          <ArrowLeft className="size-3.5" />
          <span>Overview</span>
        </Link>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-semibold tracking-tight">{data.project.label}</h1>
            <p className="text-sm text-muted-foreground">
              {data.project.resourceCount} resources · {data.findings.length} checks
            </p>
          </div>

          <div className="flex items-baseline gap-8">
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">Monthly spend</span>
              <span className="text-2xl font-semibold font-mono tabular-money">
                {formatCentsUsd(data.project.monthlyCents)}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">Possible savings</span>
              <span
                className={
                  data.project.potentialSavingsCents > 0
                    ? "text-2xl font-semibold font-mono tabular-money text-savings"
                    : "text-2xl font-semibold font-mono tabular-money text-muted-foreground"
                }
              >
                {formatCentsUsd(data.project.potentialSavingsCents)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Recommendations (Gemini / Groq) */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-1">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Cost recommendations
          </h2>

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
              className="rounded-full px-4 press-feedback"
            >
              {advising ? <Spinner data-icon="inline-start" /> : null}
              {advising ? "Checking" : aiResult ? "Analyzed" : "Get suggestions"}
            </Button>

            {aiResult ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void handleGeneratePlan(true)}
                disabled={advising}
                aria-label="Refresh suggestions"
                className="rounded-full"
              >
                <RefreshCw className="size-3.5" />
              </Button>
            ) : null}
          </div>
        </div>

        <div className="glass-panel rounded-2xl overflow-hidden">
          {!aiResult ? (
            <div className="px-6 py-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Run an on-demand check to get non-destructive AWS CLI and Terraform steps.
              </p>
              <span className="text-xs text-muted-foreground shrink-0">
                {data.aiStatus.geminiConfigured || data.aiStatus.groqConfigured
                  ? "Using your API key"
                  : "Demo preview"}
              </span>
            </div>
          ) : (
            <div className="hairline-divide">
              <div className="px-6 py-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-foreground leading-relaxed max-w-2xl">
                  {aiResult.plan.summary}
                </p>
                <div className="shrink-0 text-left sm:text-right">
                  <div className="text-lg font-semibold font-mono tabular-money text-savings">
                    -{formatCentsUsd(aiResult.plan.totalEstimatedMonthlySavingsCents)}/mo
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {aiResult.provider} · {aiResult.source}
                  </div>
                </div>
              </div>

              {aiResult.plan.actions.map((action, idx) => {
                const matchedResource = resourceById.get(action.targetResourceId);
                const consoleUrl = matchedResource
                  ? buildAwsConsoleUrl(
                      matchedResource.service,
                      matchedResource.region,
                      matchedResource.resourceId,
                    )
                  : null;

                return (
                  <details
                    key={`${action.targetResourceId}-${idx}`}
                    open={idx === 0}
                    className="group"
                  >
                    <summary className="list-none cursor-pointer px-6 py-4 flex items-center justify-between gap-4 hover:bg-secondary/50 transition-colors">
                      <div className="min-w-0 flex flex-col gap-0.5">
                        <span className="text-sm font-medium text-foreground">
                          {action.title}
                        </span>
                        <span className="text-xs text-muted-foreground font-mono">
                          {action.targetResourceId} ·{" "}
                          {action.downtimeImpact.replace(/_/g, " ")}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-sm font-mono tabular-money font-medium text-savings">
                          -{formatCentsUsd(action.estimatedMonthlySavingsCents)}/mo
                        </span>
                        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
                      </div>
                    </summary>

                    <div className="px-6 pb-5 pt-1 flex flex-col gap-4">
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {action.explanation}
                      </p>

                      <Tabs defaultValue="cli">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <TabsList>
                            <TabsTrigger value="cli">AWS CLI</TabsTrigger>
                            <TabsTrigger value="tf">Terraform</TabsTrigger>
                          </TabsList>

                          {consoleUrl ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              asChild
                              className="text-xs text-muted-foreground hover:text-foreground"
                            >
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

                        <TabsContent value="cli" className="mt-3">
                          <div className="rounded-xl bg-secondary/70 p-4 flex flex-col gap-3">
                            <code className="text-xs font-mono text-foreground break-all whitespace-pre-wrap leading-relaxed">
                              {action.cliCommand}
                            </code>
                            <div>
                              <CopyButton value={action.cliCommand} label="Copy command" />
                            </div>
                          </div>
                        </TabsContent>

                        <TabsContent value="tf" className="mt-3">
                          <div className="rounded-xl bg-secondary/70 p-4 flex flex-col gap-3">
                            <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-words leading-relaxed">
                              <code>{action.terraformSnippet}</code>
                            </pre>
                            <div>
                              <CopyButton value={action.terraformSnippet} label="Copy snippet" />
                            </div>
                          </div>
                        </TabsContent>
                      </Tabs>
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Automatic Rule Checks (Collapsible, Zero Clutter) */}
      <section className="flex flex-col gap-3">
        <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Automatic checks ({data.findings.length})
        </h2>

        <div className="glass-panel rounded-2xl overflow-hidden hairline-divide">
          {data.findings.length === 0 ? (
            <div className="px-6 py-5 text-sm text-muted-foreground">
              Nothing flagged for this project.
            </div>
          ) : (
            data.findings.map((finding) => {
              const matchedResource = resourceById.get(finding.resourceId);
              const consoleUrl = matchedResource
                ? buildAwsConsoleUrl(
                    matchedResource.service,
                    matchedResource.region,
                    matchedResource.resourceId,
                  )
                : null;

              return (
                <details key={finding.id} className="group">
                  <summary className="list-none cursor-pointer px-6 py-4 flex items-center justify-between gap-4 hover:bg-secondary/50 transition-colors">
                    <div className="min-w-0 flex flex-col gap-0.5">
                      <span
                        className={
                          finding.ruleCode === "RDS_7DAY_AUTORESTART"
                            ? "text-sm font-medium text-alert"
                            : "text-sm font-medium text-foreground"
                        }
                      >
                        {finding.title}
                      </span>
                      <span className="text-xs text-muted-foreground truncate">
                        {finding.description}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {finding.estimatedMonthlySavingsCents > 0 ? (
                        <span className="text-xs font-mono tabular-money text-savings">
                          -{formatCentsUsd(finding.estimatedMonthlySavingsCents)}/mo
                        </span>
                      ) : null}
                      <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
                    </div>
                  </summary>

                  <div className="px-6 pb-5 pt-1 flex flex-col gap-3">
                    <div className="rounded-xl bg-secondary/70 p-4 flex flex-col gap-3">
                      <code className="text-xs font-mono text-foreground break-all whitespace-pre-wrap leading-relaxed">
                        {finding.cliCommand}
                      </code>
                      <div className="flex flex-wrap items-center gap-2">
                        <CopyButton value={finding.cliCommand} label="Copy command" />
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
                  </div>
                </details>
              );
            })
          )}
        </div>
      </section>

      {/* Resources List */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Resources ({data.resources.length})
          </h2>
          <span className="text-xs text-muted-foreground">Monthly estimate</span>
        </div>

        <div className="glass-panel rounded-2xl overflow-hidden hairline-divide">
          {data.resources.map((r) => {
            const consoleUrl = buildAwsConsoleUrl(r.service, r.region, r.resourceId);
            return (
              <div
                key={r.id}
                className="px-6 py-4 flex items-center justify-between gap-4"
              >
                <div className="min-w-0 flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">
                      {r.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {SERVICE_LABELS[r.service]}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">{r.resourceId}</span>
                    <span>·</span>
                    <span>{r.region}</span>
                    <span>·</span>
                    <span>{r.state}</span>
                    <span>·</span>
                    <span>{SOURCE_LABELS[r.projectSource] ?? r.projectSource}</span>
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <span className="text-sm font-mono tabular-money font-medium">
                    {formatCentsUsd(r.monthlyCents)}
                  </span>
                  <a
                    href={consoleUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open ${r.name} in AWS Console`}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ExternalLink className="size-4" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Terraform default_tags */}
      <section className="flex flex-col gap-3">
        <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Tag future deploys automatically
        </h2>
        <div className="glass-panel rounded-2xl p-6 flex flex-col gap-4">
          <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-words leading-relaxed">
            <code>{tfDefaultTagsSnippet}</code>
          </pre>
          <div>
            <CopyButton value={tfDefaultTagsSnippet} label="Copy Terraform block" />
          </div>
        </div>
      </section>
    </div>
  );
}
