"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Download,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Tag,
  Trash2,
} from "lucide-react";
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
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
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

export function SettingsView() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Step 1: AWS Connection
  const [conn, setConn] = useState<ConnectionSettingsState | null>(null);
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [testingAws, setTestingAws] = useState(false);
  const [savingAws, setSavingAws] = useState(false);

  // Step 2: AI Keys (Gemini + Groq)
  const [ai, setAi] = useState<AiSettingsState | null>(null);
  const [geminiKeyInput, setGeminiKeyInput] = useState("");
  const [geminiModel, setGeminiModel] = useState("gemini-2.5-flash");
  const [groqKeyInput, setGroqKeyInput] = useState("");
  const [groqModel, setGroqModel] = useState("llama-3.3-70b-versatile");
  const [defaultProvider, setDefaultProvider] = useState<AiProviderPreference>("auto");
  const [fallbackEnabled, setFallbackEnabled] = useState(true);
  const [savingAi, setSavingAi] = useState(false);
  const [testingProvider, setTestingProvider] = useState<"gemini" | "groq" | null>(null);

  // Step 3: Grouping Rules & Cost Explorer
  const [rules, setRules] = useState<SavedRule[]>([]);
  const [newRuleType, setNewRuleType] = useState<"name_prefix" | "tag_key">("name_prefix");
  const [newPattern, setNewPattern] = useState("");
  const [newProjectLabel, setNewProjectLabel] = useState("");
  const [savingRule, setSavingRule] = useState(false);
  const [syncingCe, setSyncingCe] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      setLoadError(null);
      const [connRes, aiRes, rulesRes] = await Promise.all([
        fetch("/api/settings/connection", { cache: "no-store" }),
        fetch("/api/settings/ai", { cache: "no-store" }),
        fetch("/api/rules", { cache: "no-store" }),
      ]);

      if (!connRes.ok || !aiRes.ok || !rulesRes.ok) {
        const failed = !connRes.ok ? connRes : !aiRes.ok ? aiRes : rulesRes;
        const body = (await failed.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to load TagWatch settings.");
      }

      const connPayload = (await connRes.json()) as { connection: ConnectionSettingsState };
      setConn(connPayload.connection);

      const aiPayload = (await aiRes.json()) as AiSettingsState;
      setAi(aiPayload);
      setGeminiModel(aiPayload.gemini.modelId);
      setGroqModel(aiPayload.groq.modelId);
      setDefaultProvider(aiPayload.defaultProvider);
      setFallbackEnabled(aiPayload.fallbackEnabled);

      const rulesPayload = (await rulesRes.json()) as { rules: SavedRule[] };
      setRules(rulesPayload.rules);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  function toggleRegion(region: string) {
    if (!conn) return;
    const exists = conn.regions.includes(region);
    const next = exists
      ? conn.regions.filter((r) => r !== region)
      : [...conn.regions, region];
    if (next.length === 0) {
      toast.error("Select at least one AWS region.");
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
      toast.success(body.message ?? "AWS connection verified!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AWS test failed.");
    } finally {
      setTestingAws(false);
    }
  }

  async function handleSaveAws(triggerRescan: boolean) {
    if (!conn || savingAws) return;
    setSavingAws(true);
    try {
      const res = await fetch("/api/settings/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: conn.name,
          mode: conn.mode,
          regions: conn.regions,
          costExplorerEnabled: conn.costExplorerEnabled,
          ...(accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : {}),
        }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to save AWS connection.");

      setAccessKeyId("");
      setSecretAccessKey("");

      if (triggerRescan) {
        const scanRes = await fetch("/api/scans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: `settings-scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          }),
        });
        if (!scanRes.ok) {
          const scanErr = (await scanRes.json().catch(() => ({}))) as { error?: string };
          toast.warning(`Settings saved, but scan reported: ${scanErr.error ?? "error"}`);
        } else {
          toast.success("AWS settings saved and fresh scan completed!");
        }
      } else {
        toast.success("AWS settings saved.");
      }

      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save AWS settings.");
    } finally {
      setSavingAws(false);
    }
  }

  async function handleSaveAi() {
    if (savingAi) return;
    setSavingAi(true);
    try {
      const res = await fetch("/api/settings/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(geminiKeyInput.trim() ? { geminiApiKey: geminiKeyInput.trim() } : {}),
          geminiModel,
          ...(groqKeyInput.trim() ? { groqApiKey: groqKeyInput.trim() } : {}),
          groqModel,
          defaultProvider,
          fallbackEnabled,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to save AI settings.");
      }
      setGeminiKeyInput("");
      setGroqKeyInput("");
      toast.success("BYOK AI settings encrypted and saved.");
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save AI settings.");
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
          apiKey: provider === "gemini" ? geminiKeyInput.trim() || undefined : groqKeyInput.trim() || undefined,
          modelId: provider === "gemini" ? geminiModel : groqModel,
        }),
      });
      const body = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? `${provider} verification failed.`);
      }
      toast.success(body.message ?? `${provider} key verified!`);
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
      if (!res.ok) throw new Error("Failed to add rule.");
      setNewPattern("");
      setNewProjectLabel("");
      toast.success("Rule saved and resources regrouped.");
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save rule.");
    } finally {
      setSavingRule(false);
    }
  }

  async function handleDeleteRule(id: string) {
    const res = await fetch("/api/rules", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      toast.success("Rule removed.");
      await loadAll();
    }
  }

  async function handleSyncCostExplorer() {
    if (syncingCe) return;
    setSyncingCe(true);
    try {
      const res = await fetch("/api/cost-explorer/sync", { method: "POST" });
      const body = (await res.json()) as {
        source?: "fresh" | "cached";
        actualMtdCents?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? "Cost Explorer sync failed.");
      toast.success(
        body.source === "cached"
          ? `Returned 24h cached Cost Explorer MTD: ${formatCentsUsd(body.actualMtdCents ?? 0)} ($0.00)`
          : `Synced Cost Explorer MTD: ${formatCentsUsd(body.actualMtdCents ?? 0)} ($0.01)`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Cost Explorer sync failed.");
    } finally {
      setSyncingCe(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    );
  }

  if (loadError || !conn || !ai) {
    return (
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>Unable to load Settings</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <span>{loadError ?? "Unexpected empty settings response."}</span>
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Connect AWS & BYOK Keys</h1>
        <p className="text-sm text-muted-foreground">
          Open-source self-hosted setup. All saved keys are encrypted at rest with AES-256-GCM
          and never sent back to the browser.
        </p>
      </div>

      <Tabs defaultValue="aws">
        <TabsList>
          <TabsTrigger value="aws">1. Connect AWS</TabsTrigger>
          <TabsTrigger value="ai">2. AI Keys (Gemini & Groq)</TabsTrigger>
          <TabsTrigger value="rules">3. Project Rules & Billing</TabsTrigger>
        </TabsList>

        {/* STEP 1: AWS */}
        <TabsContent value="aws" className="mt-4 flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cloud className="size-4" />
                <span>Step 1 — Choose AWS Connection Mode</span>
              </CardTitle>
              <CardDescription>
                TagWatch requires strictly read-only permissions. It can never modify or delete
                your AWS infrastructure.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
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
                <ToggleGroupItem value="demo">Demo Mode (Zero Keys)</ToggleGroupItem>
                <ToggleGroupItem value="iam_keys">Read-Only IAM Keys (BYOK)</ToggleGroupItem>
                <ToggleGroupItem value="env_default">Local AWS CLI / Env</ToggleGroupItem>
              </ToggleGroup>

              {conn.mode === "iam_keys" ? (
                <div className="flex flex-col gap-4">
                  <Alert>
                    <ShieldCheck />
                    <AlertTitle>30-Second Read-Only IAM Setup</AlertTitle>
                    <AlertDescription className="flex flex-col gap-3 pt-1">
                      <span>
                        Download our CloudFormation template to create a strictly read-only{" "}
                        <code>tagwatch-readonly</code> IAM user, or copy the minimal JSON policy
                        below into AWS IAM.
                      </span>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" asChild>
                          <a href="/api/templates/readonly-iam" download>
                            <Download data-icon="inline-start" />
                            Download CloudFormation YAML
                          </a>
                        </Button>
                        <CopyButton value={iamPolicyJson} label="Copy IAM Policy JSON" />
                      </div>
                    </AlertDescription>
                  </Alert>

                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="aws-access-key">AWS Access Key ID</FieldLabel>
                      <Input
                        id="aws-access-key"
                        placeholder={
                          conn.credentials.configured
                            ? `Saved (ending in ${conn.credentials.last4}) — leave blank to keep`
                            : "AKIA..."
                        }
                        value={accessKeyId}
                        onChange={(e) => setAccessKeyId(e.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="aws-secret-key">AWS Secret Access Key</FieldLabel>
                      <Input
                        id="aws-secret-key"
                        type="password"
                        placeholder={
                          conn.credentials.configured
                            ? "•••••••••••••••• (encrypted in Postgres)"
                            : "Enter read-only secret key"
                        }
                        value={secretAccessKey}
                        onChange={(e) => setSecretAccessKey(e.target.value)}
                      />
                      <FieldDescription>
                        Encrypted with AES-256-GCM before storage. Never logged or exposed to
                        client JS.
                      </FieldDescription>
                    </Field>
                  </FieldGroup>
                </div>
              ) : null}

              {conn.mode === "env_default" ? (
                <Alert>
                  <CheckCircle2 />
                  <AlertTitle>Uses Server Environment or Local ~/.aws Profile</AlertTitle>
                  <AlertDescription>
                    TagWatch will use the AWS SDK default credential provider chain (
                    <code>AWS_ACCESS_KEY_ID</code> / <code>~/.aws/credentials</code> / EC2
                    instance role). Detected in env:{" "}
                    <strong>{conn.envAwsAvailable ? "Yes" : "Using local AWS profile"}</strong>.
                  </AlertDescription>
                </Alert>
              ) : null}

              <Separator />

              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">AWS Regions to Scan ($0 Describe*)</span>
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
                        className="font-mono text-xs active:scale-[0.97]"
                      >
                        {region}
                      </Button>
                    );
                  })}
                </div>
              </div>
            </CardContent>
            <CardFooter className="justify-between flex-wrap gap-2 border-t border-border/60 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleTestAws()}
                disabled={testingAws}
              >
                {testingAws ? <Spinner data-icon="inline-start" /> : null}
                Test Connection
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void handleSaveAws(false)}
                  disabled={savingAws}
                >
                  Save
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleSaveAws(true)}
                  disabled={savingAws}
                >
                  {savingAws ? <Spinner data-icon="inline-start" /> : null}
                  Save & Scan Now
                </Button>
              </div>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Minimal Read-Only IAM Policy JSON</CardTitle>
              <CardDescription>
                Zero write permissions — safe for open-source auditing
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-3 text-xs font-mono">
                <code>{iamPolicyJson}</code>
              </pre>
            </CardContent>
          </Card>
        </TabsContent>

        {/* STEP 2: AI KEYS (GEMINI + GROQ) */}
        <TabsContent value="ai" className="mt-4 flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="size-4" />
                <span>Step 2 — Dual BYOK AI Advisor (Gemini + Groq)</span>
              </CardTitle>
              <CardDescription>
                Configure Gemini, Groq, or both. When Auto-Fallback is on, TagWatch seamlessly
                switches to your second provider if one hits a rate limit or timeout.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium">Default AI Provider</span>
                  <span className="text-xs text-muted-foreground">
                    Can also be overridden per project click
                  </span>
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
                  <ToggleGroupItem value="auto">Auto (Gemini → Groq)</ToggleGroupItem>
                  <ToggleGroupItem value="gemini">Gemini</ToggleGroupItem>
                  <ToggleGroupItem value="groq">Groq</ToggleGroupItem>
                </ToggleGroup>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">Enable Automatic Fallback</span>
                  <span className="text-xs text-muted-foreground">
                    If your primary provider returns 429 or times out, automatically retry with the
                    other configured key.
                  </span>
                </div>
                <Switch checked={fallbackEnabled} onCheckedChange={setFallbackEnabled} />
              </div>

              <Separator />

              {/* Gemini */}
              <FieldGroup>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold flex items-center gap-2">
                    <KeyRound className="size-4" />
                    Google Gemini
                  </span>
                  <Badge variant={ai.gemini.configured ? "default" : "outline"}>
                    {ai.gemini.configured
                      ? `Configured (${ai.gemini.source} · ••••${ai.gemini.last4})`
                      : "Not configured"}
                  </Badge>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="gemini-key">Gemini API Key</FieldLabel>
                    <Input
                      id="gemini-key"
                      type="password"
                      placeholder={
                        ai.gemini.configured ? "Leave blank to keep saved key" : "AIza..."
                      }
                      value={geminiKeyInput}
                      onChange={(e) => setGeminiKeyInput(e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="gemini-model">Gemini Model</FieldLabel>
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
                    disabled={testingProvider !== null}
                  >
                    {testingProvider === "gemini" ? (
                      <Spinner data-icon="inline-start" />
                    ) : null}
                    Verify Gemini Key
                  </Button>
                </div>
              </FieldGroup>

              <Separator />

              {/* Groq */}
              <FieldGroup>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold flex items-center gap-2">
                    <KeyRound className="size-4" />
                    Groq
                  </span>
                  <Badge variant={ai.groq.configured ? "default" : "outline"}>
                    {ai.groq.configured
                      ? `Configured (${ai.groq.source} · ••••${ai.groq.last4})`
                      : "Not configured"}
                  </Badge>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="groq-key">Groq API Key</FieldLabel>
                    <Input
                      id="groq-key"
                      type="password"
                      placeholder={
                        ai.groq.configured ? "Leave blank to keep saved key" : "gsk_..."
                      }
                      value={groqKeyInput}
                      onChange={(e) => setGroqKeyInput(e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="groq-model">Groq Model</FieldLabel>
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
                    disabled={testingProvider !== null}
                  >
                    {testingProvider === "groq" ? (
                      <Spinner data-icon="inline-start" />
                    ) : null}
                    Verify Groq Key
                  </Button>
                </div>
              </FieldGroup>
            </CardContent>
            <CardFooter className="justify-end border-t border-border/60 pt-4">
              <Button type="button" onClick={() => void handleSaveAi()} disabled={savingAi}>
                {savingAi ? <Spinner data-icon="inline-start" /> : null}
                Save Encrypted AI Settings
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        {/* STEP 3: PROJECT RULES & 24H COST EXPLORER GUARD */}
        <TabsContent value="rules" className="mt-4 flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Tag className="size-4" />
                <span>Step 3 — Retroactive Project Grouping Rules</span>
              </CardTitle>
              <CardDescription>
                TagWatch automatically reads <code>Project</code>, <code>app</code>, and{" "}
                <code>aws:cloudformation:stack-name</code> tags. Add name-prefix rules here to
                auto-group untagged legacy resources (e.g., <code>cloudpress-*</code>).
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <form
                onSubmit={(e) => void handleAddRule(e)}
                className="grid grid-cols-1 gap-3 sm:grid-cols-4 items-end"
              >
                <Field>
                  <FieldLabel>Rule Type</FieldLabel>
                  <Select
                    value={newRuleType}
                    onValueChange={(v) => setNewRuleType(v as "name_prefix" | "tag_key")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="name_prefix">Name Prefix</SelectItem>
                        <SelectItem value="tag_key">Custom Tag Key</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel htmlFor="rule-pattern">Pattern</FieldLabel>
                  <Input
                    id="rule-pattern"
                    placeholder={newRuleType === "name_prefix" ? "cloudpress-*" : "ServiceName"}
                    value={newPattern}
                    onChange={(e) => setNewPattern(e.target.value)}
                    required
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="rule-project">Target Project</FieldLabel>
                  <Input
                    id="rule-project"
                    placeholder="CloudPress"
                    value={newProjectLabel}
                    onChange={(e) => setNewProjectLabel(e.target.value)}
                    required
                  />
                </Field>

                <Button type="submit" disabled={savingRule}>
                  {savingRule ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <Plus data-icon="inline-start" />
                  )}
                  Add Rule
                </Button>
              </form>

              {rules.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {rules.map((rule) => (
                    <div
                      key={rule.id}
                      className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">{rule.ruleType}</Badge>
                        <code className="font-mono text-xs">{rule.pattern}</code>
                        <span className="text-muted-foreground">→</span>
                        <span className="font-medium">{rule.projectLabel}</span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => void handleDeleteRule(rule.id)}
                        aria-label="Delete rule"
                      >
                        <Trash2 className="size-4 text-muted-foreground" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No custom rules saved yet. Built-in tag matching and parent-attachment
                  inheritance are always active.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Optional 24h Cost Explorer Guard */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Optional Daily Cost Explorer Sync (Hard-Capped at 1×/24h)
              </CardTitle>
              <CardDescription>
                AWS Cost Explorer charges $0.01 per request. TagWatch locks syncs in PostgreSQL
                for 24 hours (max $0.30/month) and never polls it from the browser.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">Allow 24h Cost Explorer Sync</span>
                  <span className="text-xs text-muted-foreground">
                    Requires ce:GetCostAndUsage in your read-only IAM policy
                  </span>
                </div>
                <Switch
                  checked={conn.costExplorerEnabled}
                  onCheckedChange={(checked) =>
                    setConn({ ...conn, costExplorerEnabled: checked })
                  }
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void handleSaveAws(false)}
                  disabled={savingAws}
                >
                  Save Cost Explorer Preference
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void handleSyncCostExplorer()}
                  disabled={!conn.costExplorerEnabled || conn.mode === "demo" || syncingCe}
                >
                  {syncingCe ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <RefreshCw data-icon="inline-start" />
                  )}
                  Sync Actual MTD ($0.01 max/24h)
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Starter Terraform <code>default_tags</code> Block
              </CardTitle>
              <CardDescription>
                Drop this into new Terraform projects so every future resource tags itself
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <div className="flex flex-col gap-3 rounded-lg bg-muted p-3 sm:flex-row sm:items-start sm:justify-between">
                <pre className="overflow-x-auto text-xs font-mono">
                  <code>{buildTerraformDefaultTags("my-new-project")}</code>
                </pre>
                <CopyButton
                  value={buildTerraformDefaultTags("my-new-project")}
                  label="Copy HCL"
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
