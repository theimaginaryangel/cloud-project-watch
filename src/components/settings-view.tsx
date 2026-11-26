"use client";

import { Download, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CopyButton } from "@/components/copy-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getReadOnlyPolicyJson } from "@/lib/aws/iam-policy";
import { formatCentsUsd, type AiProviderPreference } from "@/lib/domain/types";
import { buildTerraformDefaultTags } from "@/lib/grouping/project-grouper";

const COMMON_AWS_REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "eu-west-1",
  "eu-central-1",
  "ap-southeast-1",
  "af-south-1",
] as const;

interface ConnectionSettingsState {
  name: string;
  mode: "demo" | "iam_keys" | "env_default";
  regions: string[];
  costExplorerEnabled: boolean;
  credentials: { configured: boolean; last4: string | null };
  envAwsAvailable: boolean;
  ambientAwsAllowed?: boolean;
  publicDemoLocked?: boolean;
}

interface AiSettingsState {
  gemini: { configured: boolean; last4: string | null; source: string; modelId: string };
  groq: { configured: boolean; last4: string | null; source: string; modelId: string };
  defaultProvider: AiProviderPreference;
  fallbackEnabled: boolean;
}

interface SavedRule {
  id: string;
  ruleType: "arn_override" | "tag_key" | "name_prefix";
  pattern: string;
  projectSlug: string;
  projectLabel: string;
}

async function fetchAllSettingsPayload(): Promise<{
  connection: ConnectionSettingsState;
  ai: AiSettingsState;
  rules: SavedRule[];
}> {
  const [connRes, aiRes, rulesRes] = await Promise.all([
    fetch("/api/settings/connection", { cache: "no-store" }),
    fetch("/api/settings/ai", { cache: "no-store" }),
    fetch("/api/rules", { cache: "no-store" }),
  ]);

  if (!connRes.ok || !aiRes.ok || !rulesRes.ok) {
    const failed = !connRes.ok ? connRes : !aiRes.ok ? aiRes : rulesRes;
    const body = (await failed.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Could not load settings.");
  }

  const connPayload = (await connRes.json()) as { connection: ConnectionSettingsState };
  const aiPayload = (await aiRes.json()) as AiSettingsState;
  const rulesPayload = (await rulesRes.json()) as { rules: SavedRule[] };

  return {
    connection: connPayload.connection,
    ai: aiPayload,
    rules: rulesPayload.rules,
  };
}

export function SettingsView() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [conn, setConn] = useState<ConnectionSettingsState | null>(null);
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [testingAws, setTestingAws] = useState(false);
  const [savingAws, setSavingAws] = useState(false);

  const [ai, setAi] = useState<AiSettingsState | null>(null);
  const [geminiKeyInput, setGeminiKeyInput] = useState("");
  const [geminiModel, setGeminiModel] = useState("gemini-2.5-flash");
  const [groqKeyInput, setGroqKeyInput] = useState("");
  const [groqModel, setGroqModel] = useState("llama-3.3-70b-versatile");
  const [defaultProvider, setDefaultProvider] = useState<AiProviderPreference>("auto");
  const [fallbackEnabled, setFallbackEnabled] = useState(true);
  const [savingAi, setSavingAi] = useState(false);
  const [testingProvider, setTestingProvider] = useState<"gemini" | "groq" | null>(null);

  const [rules, setRules] = useState<SavedRule[]>([]);
  const [newRuleType, setNewRuleType] = useState<"name_prefix" | "tag_key">("name_prefix");
  const [newPattern, setNewPattern] = useState("");
  const [newProjectLabel, setNewProjectLabel] = useState("");
  const [savingRule, setSavingRule] = useState(false);
  const [syncingCe, setSyncingCe] = useState(false);

  const pendingScanKeyRef = useRef<string | null>(null);

  const applySettingsPayload = useCallback(
    (payload: Awaited<ReturnType<typeof fetchAllSettingsPayload>>) => {
      setConn(payload.connection);
      setAi(payload.ai);
      setGeminiModel(payload.ai.gemini.modelId);
      setGroqModel(payload.ai.groq.modelId);
      setDefaultProvider(payload.ai.defaultProvider);
      setFallbackEnabled(payload.ai.fallbackEnabled);
      setRules(payload.rules);
      setLoadError(null);
    },
    [],
  );

  const loadAll = useCallback(async () => {
    try {
      const payload = await fetchAllSettingsPayload();
      applySettingsPayload(payload);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load settings.");
    } finally {
      setLoading(false);
    }
  }, [applySettingsPayload]);

  useEffect(() => {
    let cancelled = false;
    fetchAllSettingsPayload()
      .then((payload) => {
        if (!cancelled) applySettingsPayload(payload);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Could not load settings.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applySettingsPayload]);

  function toggleRegion(region: string) {
    if (!conn) return;
    const exists = conn.regions.includes(region);
    const next = exists
      ? conn.regions.filter((r) => r !== region)
      : [...conn.regions, region];
    if (next.length === 0) {
      toast.error("Select at least one region.");
      return;
    }
    setConn({ ...conn, regions: next });
  }

  async function handleTestAws() {
    if (!conn || testingAws) return;
    setTestingAws(true);
    try {
      const res = await fetch("/api/settings/connection/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: conn.mode,
          region: conn.regions[0] ?? "us-east-1",
          ...(accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : {}),
        }),
      });
      const body = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? "Connection test failed.");
      }
      toast(body.message ?? "AWS connection verified.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AWS test failed.");
    } finally {
      setTestingAws(false);
    }
  }

  async function handleSaveAws(triggerRescan: boolean, clearCredentials = false) {
    if (!conn || savingAws) return;
    setSavingAws(true);
    try {
      const nextMode = clearCredentials && conn.mode === "iam_keys" ? "demo" : conn.mode;
      const res = await fetch("/api/settings/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: conn.name,
          mode: nextMode,
          regions: conn.regions,
          costExplorerEnabled: conn.costExplorerEnabled,
          ...(clearCredentials ? { clearCredentials: true } : {}),
          ...(accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : {}),
        }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not save AWS settings.");

      setAccessKeyId("");
      setSecretAccessKey("");

      if (triggerRescan) {
        const scanKey =
          pendingScanKeyRef.current ??
          `settings-scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        pendingScanKeyRef.current = scanKey;

        const scanRes = await fetch("/api/scans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idempotencyKey: scanKey }),
        });
        if (!scanRes.ok) {
          if (scanRes.status < 500) pendingScanKeyRef.current = null;
          const scanErr = (await scanRes.json().catch(() => ({}))) as { error?: string };
          toast.error(`Saved, but scan failed: ${scanErr.error ?? "unknown error"}`);
        } else {
          pendingScanKeyRef.current = null;
          toast("Saved and scanned AWS");
        }
      } else {
        toast(clearCredentials ? "Saved AWS keys cleared" : "AWS settings saved");
      }

      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save AWS settings.");
    } finally {
      setSavingAws(false);
    }
  }

  async function handleSaveAi(options?: { clearGemini?: boolean; clearGroq?: boolean }) {
    if (savingAi) return;
    setSavingAi(true);
    try {
      const res = await fetch("/api/settings/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(geminiKeyInput.trim() ? { geminiApiKey: geminiKeyInput.trim() } : {}),
          ...(options?.clearGemini ? { clearGeminiKey: true } : {}),
          geminiModel,
          ...(groqKeyInput.trim() ? { groqApiKey: groqKeyInput.trim() } : {}),
          ...(options?.clearGroq ? { clearGroqKey: true } : {}),
          groqModel,
          defaultProvider,
          fallbackEnabled,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not save API keys.");
      }
      setGeminiKeyInput("");
      setGroqKeyInput("");
      toast(
        options?.clearGemini || options?.clearGroq
          ? "Saved API key cleared"
          : "API keys encrypted and saved",
      );
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save API keys.");
    } finally {
      setSavingAi(false);
    }
  }

  async function handleVerifyAi(provider: "gemini" | "groq") {
    if (testingProvider) return;
    setTestingProvider(provider);
    try {
      const res = await fetch("/api/settings/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          apiKey:
            provider === "gemini"
              ? geminiKeyInput.trim() || undefined
              : groqKeyInput.trim() || undefined,
          modelId: provider === "gemini" ? geminiModel : groqModel,
        }),
      });
      const body = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? `${provider} verification failed.`);
      }
      toast(body.message ?? `${provider} key works.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setTestingProvider(null);
    }
  }

  async function handleAddRule(e: React.FormEvent) {
    e.preventDefault();
    if (!newPattern.trim() || !newProjectLabel.trim() || savingRule) return;
    setSavingRule(true);
    try {
      const res = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ruleType: newRuleType,
          pattern: newPattern.trim(),
          projectLabel: newProjectLabel.trim(),
          rescanAfterSave: true,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not save rule.");
      setNewPattern("");
      setNewProjectLabel("");
      toast("Rule saved");
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save rule.");
    } finally {
      setSavingRule(false);
    }
  }

  async function handleDeleteRule(id: string) {
    if (conn?.publicDemoLocked) return;
    const res = await fetch("/api/rules", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      toast("Rule removed");
      await loadAll();
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(body.error ?? "Could not delete rule.");
    }
  }

  async function handleSyncCostExplorer() {
    if (syncingCe) return;
    setSyncingCe(true);
    try {
      const res = await fetch("/api/cost-explorer/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = (await res.json()) as {
        source?: "fresh" | "cached";
        actualMtdCents?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? "Cost Explorer sync failed.");
      toast(
        body.source === "cached"
          ? `Cached MTD: ${formatCentsUsd(body.actualMtdCents ?? 0)}`
          : `Synced MTD: ${formatCentsUsd(body.actualMtdCents ?? 0)}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Cost Explorer sync failed.");
    } finally {
      setSyncingCe(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-80 w-full rounded-2xl" />
      </div>
    );
  }

  if (loadError || !conn || !ai) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load settings</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <span>{loadError ?? "Unexpected error."}</span>
          <div>
            <Button variant="outline" size="sm" onClick={() => void loadAll()}>
              Try again
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  const iamPolicyJson = getReadOnlyPolicyJson(conn.costExplorerEnabled);
  const demoLocked = Boolean(conn.publicDemoLocked);
  const ambientAllowed = Boolean(conn.ambientAwsAllowed);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Connect a read-only AWS account, add your own Gemini or Groq keys, and manage grouping
          rules. Keys are encrypted with AES-256-GCM.
        </p>
      </div>

      {demoLocked ? (
        <div className="glass-panel rounded-2xl px-6 py-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Public demo mode is read-only so visitor keys are never stored in a shared database.
            Deploy your own copy to connect AWS and API keys.
          </p>
          <Button variant="outline" size="sm" asChild className="rounded-full shrink-0 w-fit">
            <a
              href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ftheimaginaryangel%2Fcloud-project-watch&env=DATABASE_URL,APP_ENCRYPTION_KEY,OWNER_PASSWORD"
              target="_blank"
              rel="noopener noreferrer"
            >
              Deploy your own
            </a>
          </Button>
        </div>
      ) : null}

      <Tabs defaultValue="aws">
        <TabsList>
          <TabsTrigger value="aws">AWS account</TabsTrigger>
          <TabsTrigger value="ai">API keys</TabsTrigger>
          <TabsTrigger value="rules">Rules & billing</TabsTrigger>
        </TabsList>

        {/* TAB 1: AWS */}
        <TabsContent value="aws" className="mt-6 flex flex-col gap-6">
          <div className="glass-panel rounded-2xl overflow-hidden hairline-divide">
            <div className="p-6 flex flex-col gap-5">
              <div className="flex flex-col gap-1">
                <h2 className="text-base font-medium">Connection mode</h2>
                <p className="text-xs text-muted-foreground">
                  CloudProjectWatch only reads AWS metadata. It cannot stop or delete resources.
                </p>
              </div>

              <ToggleGroup
                type="single"
                value={conn.mode}
                onValueChange={(val) => {
                  if (val === "demo" || val === "iam_keys" || val === "env_default") {
                    setConn({ ...conn, mode: val });
                  }
                }}
                variant="outline"
                className="justify-start flex-wrap"
              >
                <ToggleGroupItem value="demo">Demo data</ToggleGroupItem>
                <ToggleGroupItem value="iam_keys">Read-only IAM keys</ToggleGroupItem>
                <ToggleGroupItem value="env_default" disabled={!ambientAllowed && conn.mode !== "env_default"}>
                  Local AWS CLI
                </ToggleGroupItem>
              </ToggleGroup>

              {conn.mode === "iam_keys" ? (
                <div className="flex flex-col gap-5 pt-2">
                  <div className="rounded-xl bg-secondary/60 p-4 flex flex-col gap-3">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Create a read-only IAM user with our CloudFormation template or copy the
                      JSON policy below.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <a href="/api/templates/readonly-iam" download>
                          <Download data-icon="inline-start" />
                          Download template
                        </a>
                      </Button>
                      <CopyButton value={iamPolicyJson} label="Copy IAM policy" />
                    </div>
                  </div>

                  <FieldGroup>
                    <Field>
                      <div className="flex items-center justify-between gap-2">
                        <FieldLabel htmlFor="aws-access-key">Access Key ID</FieldLabel>
                        {conn.credentials.configured ? (
                          <button
                            type="button"
                            disabled={savingAws || demoLocked}
                            onClick={() => void handleSaveAws(false, true)}
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                          >
                            Clear saved keys
                          </button>
                        ) : null}
                      </div>
                      <Input
                        id="aws-access-key"
                        placeholder={
                          conn.credentials.configured
                            ? `Saved (ending in ${conn.credentials.last4})`
                            : "AKIA..."
                        }
                        value={accessKeyId}
                        onChange={(e) => setAccessKeyId(e.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="aws-secret-key">Secret Access Key</FieldLabel>
                      <Input
                        id="aws-secret-key"
                        type="password"
                        placeholder={
                          conn.credentials.configured
                            ? "Leave blank to keep saved key"
                            : "Paste secret key"
                        }
                        value={secretAccessKey}
                        onChange={(e) => setSecretAccessKey(e.target.value)}
                      />
                    </Field>
                  </FieldGroup>
                </div>
              ) : null}

              {conn.mode === "env_default" ? (
                <p className="text-xs text-muted-foreground">
                  {ambientAllowed ? (
                    <>
                      Reads credentials from environment variables or your local{" "}
                      <code className="font-mono">~/.aws/credentials</code> profile. Env keys
                      detected: {conn.envAwsAvailable ? "Yes" : "No (using local profile)"}.
                    </>
                  ) : (
                    <>
                      Disabled by default for host safety. Set{" "}
                      <code className="font-mono">ALLOW_AMBIENT_AWS_CREDENTIALS=true</code> in{" "}
                      <code className="font-mono">.env</code> on trusted local machines.
                    </>
                  )}
                </p>
              ) : null}
            </div>

            <div className="p-6 flex flex-col gap-3">
              <span className="text-sm font-medium">Regions</span>
              <div className="flex flex-wrap gap-2">
                {COMMON_AWS_REGIONS.map((region) => {
                  const selected = conn.regions.includes(region);
                  return (
                    <Button
                      key={region}
                      type="button"
                      size="sm"
                      variant={selected ? "default" : "outline"}
                      onClick={() => toggleRegion(region)}
                      className="rounded-full font-mono text-xs press-feedback"
                    >
                      {region}
                    </Button>
                  );
                })}
              </div>
            </div>

            <div className="px-6 py-4 flex flex-wrap items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleTestAws()}
                disabled={testingAws}
                className="rounded-full"
              >
                {testingAws ? <Spinner data-icon="inline-start" /> : null}
                Test connection
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleSaveAws(false)}
                  disabled={savingAws || demoLocked}
                  className="rounded-full"
                >
                  Save
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleSaveAws(true)}
                  disabled={savingAws || demoLocked}
                  className="rounded-full press-feedback"
                >
                  {savingAws ? <Spinner data-icon="inline-start" /> : null}
                  Save & scan
                </Button>
              </div>
            </div>
          </div>

          <details className="glass-panel rounded-2xl overflow-hidden">
            <summary className="list-none cursor-pointer px-6 py-4 text-sm font-medium flex items-center justify-between hover:bg-secondary/40">
              <span>View minimal read-only IAM policy JSON</span>
              <CopyButton value={iamPolicyJson} label="Copy JSON" />
            </summary>
            <div className="px-6 pb-5">
              <pre className="rounded-xl bg-secondary/70 p-4 text-xs font-mono whitespace-pre-wrap break-words">
                <code>{iamPolicyJson}</code>
              </pre>
            </div>
          </details>
        </TabsContent>

        {/* TAB 2: AI KEYS */}
        <TabsContent value="ai" className="mt-6">
          <div className="glass-panel rounded-2xl overflow-hidden hairline-divide">
            <div className="p-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-0.5">
                <h2 className="text-sm font-medium">Default provider</h2>
                <p className="text-xs text-muted-foreground">
                  Add Gemini, Groq, or both. You can also switch per project.
                </p>
              </div>
              <ToggleGroup
                type="single"
                value={defaultProvider}
                onValueChange={(val) => {
                  if (val === "auto" || val === "gemini" || val === "groq") {
                    setDefaultProvider(val);
                  }
                }}
                variant="outline"
              >
                <ToggleGroupItem value="auto">Auto</ToggleGroupItem>
                <ToggleGroupItem value="gemini">Gemini</ToggleGroupItem>
                <ToggleGroupItem value="groq">Groq</ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className="px-6 py-4 flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">Automatic fallback</span>
                <span className="text-xs text-muted-foreground">
                  Retry with your second key if the first hits a rate limit or timeout.
                </span>
              </div>
              <Switch checked={fallbackEnabled} onCheckedChange={setFallbackEnabled} />
            </div>

            <div className="p-6 flex flex-col gap-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Google Gemini</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {ai.gemini.configured ? `Saved (••••${ai.gemini.last4})` : "Not set"}
                  </span>
                  {ai.gemini.source === "saved" ? (
                    <button
                      type="button"
                      disabled={savingAi || demoLocked}
                      onClick={() => void handleSaveAi({ clearGemini: true })}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="gemini-key">API key</FieldLabel>
                  <Input
                    id="gemini-key"
                    type="password"
                    placeholder={ai.gemini.configured ? "Leave blank to keep" : "AIza..."}
                    value={geminiKeyInput}
                    onChange={(e) => setGeminiKeyInput(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="gemini-model">Model</FieldLabel>
                  <Input
                    id="gemini-model"
                    value={geminiModel}
                    onChange={(e) => setGeminiModel(e.target.value)}
                  />
                </Field>
              </div>
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void handleVerifyAi("gemini")}
                  disabled={testingProvider !== null || demoLocked}
                  className="rounded-full"
                >
                  {testingProvider === "gemini" ? <Spinner data-icon="inline-start" /> : null}
                  Verify Gemini
                </Button>
              </div>
            </div>

            <div className="p-6 flex flex-col gap-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Groq</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {ai.groq.configured ? `Saved (••••${ai.groq.last4})` : "Not set"}
                  </span>
                  {ai.groq.source === "saved" ? (
                    <button
                      type="button"
                      disabled={savingAi || demoLocked}
                      onClick={() => void handleSaveAi({ clearGroq: true })}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="groq-key">API key</FieldLabel>
                  <Input
                    id="groq-key"
                    type="password"
                    placeholder={ai.groq.configured ? "Leave blank to keep" : "gsk_..."}
                    value={groqKeyInput}
                    onChange={(e) => setGroqKeyInput(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="groq-model">Model</FieldLabel>
                  <Input
                    id="groq-model"
                    value={groqModel}
                    onChange={(e) => setGroqModel(e.target.value)}
                  />
                </Field>
              </div>
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void handleVerifyAi("groq")}
                  disabled={testingProvider !== null || demoLocked}
                  className="rounded-full"
                >
                  {testingProvider === "groq" ? <Spinner data-icon="inline-start" /> : null}
                  Verify Groq
                </Button>
              </div>
            </div>

            <div className="px-6 py-4 flex justify-end">
              <Button
                type="button"
                size="sm"
                onClick={() => void handleSaveAi()}
                disabled={savingAi || demoLocked}
                className="rounded-full px-5 press-feedback"
              >
                {savingAi ? <Spinner data-icon="inline-start" /> : null}
                Save keys
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* TAB 3: RULES & BILLING */}
        <TabsContent value="rules" className="mt-6 flex flex-col gap-6">
          <div className="glass-panel rounded-2xl overflow-hidden hairline-divide">
            <div className="p-6 flex flex-col gap-4">
              <div className="flex flex-col gap-0.5">
                <h2 className="text-sm font-medium">Project grouping rules</h2>
                <p className="text-xs text-muted-foreground">
                  Resources with Project, app, or CloudFormation stack tags group automatically.
                  Add name-prefix rules for untagged resources.
                </p>
              </div>

              <form
                onSubmit={(e) => void handleAddRule(e)}
                className="grid grid-cols-1 gap-3 sm:grid-cols-4 items-end"
              >
                <Field>
                  <FieldLabel>Type</FieldLabel>
                  <Select
                    value={newRuleType}
                    onValueChange={(v) => setNewRuleType(v as "name_prefix" | "tag_key")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="name_prefix">Name prefix</SelectItem>
                        <SelectItem value="tag_key">Tag key</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel htmlFor="rule-pattern">Pattern</FieldLabel>
                  <Input
                    id="rule-pattern"
                    placeholder={newRuleType === "name_prefix" ? "cloudpress-*" : "Service"}
                    value={newPattern}
                    onChange={(e) => setNewPattern(e.target.value)}
                    required
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="rule-project">Project</FieldLabel>
                  <Input
                    id="rule-project"
                    placeholder="CloudPress"
                    value={newProjectLabel}
                    onChange={(e) => setNewProjectLabel(e.target.value)}
                    required
                  />
                </Field>

                <Button
                  type="submit"
                  disabled={savingRule || demoLocked}
                  className="rounded-full"
                >
                  {savingRule ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <Plus data-icon="inline-start" />
                  )}
                  Add rule
                </Button>
              </form>
            </div>

            {rules.length > 0 ? (
              <div className="hairline-divide">
                {rules.map((rule) => (
                  <div
                    key={rule.id}
                    className="px-6 py-3.5 flex items-center justify-between text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">{rule.ruleType}</span>
                      <code className="font-mono text-xs">{rule.pattern}</code>
                      <span className="text-muted-foreground">→</span>
                      <span className="font-medium">{rule.projectLabel}</span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={demoLocked}
                      onClick={() => void handleDeleteRule(rule.id)}
                      aria-label="Delete rule"
                    >
                      <Trash2 className="size-4 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="glass-panel rounded-2xl overflow-hidden hairline-divide">
            <div className="p-6 flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <h2 className="text-sm font-medium">Daily Cost Explorer sync (optional)</h2>
                <p className="text-xs text-muted-foreground">
                  AWS charges $0.01 per request. Locked to at most once every 24 hours (max
                  $0.30/month).
                </p>
              </div>
              <Switch
                checked={conn.costExplorerEnabled}
                disabled={demoLocked}
                onCheckedChange={(checked) =>
                  setConn({ ...conn, costExplorerEnabled: checked })
                }
              />
            </div>

            <div className="px-6 py-4 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleSaveAws(false)}
                disabled={savingAws || demoLocked}
                className="rounded-full"
              >
                Save preference
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void handleSyncCostExplorer()}
                disabled={
                  !conn.costExplorerEnabled ||
                  conn.mode === "demo" ||
                  syncingCe ||
                  demoLocked
                }
                className="rounded-full"
              >
                {syncingCe ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <RefreshCw data-icon="inline-start" />
                )}
                Sync actual MTD
              </Button>
            </div>
          </div>

          <div className="glass-panel rounded-2xl p-6 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">Terraform default_tags starter</span>
              <CopyButton
                value={buildTerraformDefaultTags("my-new-project")}
                label="Copy HCL"
              />
            </div>
            <pre className="rounded-xl bg-secondary/70 p-4 text-xs font-mono whitespace-pre-wrap break-words">
              <code>{buildTerraformDefaultTags("my-new-project")}</code>
            </pre>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
