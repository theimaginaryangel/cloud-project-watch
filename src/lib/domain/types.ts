import { z } from "zod";
import {
  isSafeAwsCliCommand,
  isSafeTerraformSnippet,
} from "@/lib/security/shell";

export const ORPHANED_PROJECT_SLUG = "__orphaned__" as const;
export const ORPHANED_PROJECT_LABEL = "Untagged" as const;

export const AWS_SERVICES = [
  "ec2",
  "ebs",
  "eip",
  "nat_gateway",
  "rds",
  "secrets_manager",
  "elb",
] as const;

export type AwsService = (typeof AWS_SERVICES)[number];

export const SERVICE_LABELS: Record<AwsService, string> = {
  ec2: "EC2 Compute",
  ebs: "EBS Volumes",
  eip: "Elastic IPs",
  nat_gateway: "NAT Gateways",
  rds: "RDS Databases",
  secrets_manager: "Secrets Manager",
  elb: "Load Balancers",
};

export type ProjectSource = "override" | "tag" | "prefix" | "parent" | "orphaned";

export type RuleCode =
  | "UNATTACHED_EIP"
  | "ORPHANED_EBS"
  | "RDS_7DAY_AUTORESTART"
  | "SECRETS_TO_SSM"
  | "RDS_PROVISIONED_IOPS"
  | "RDS_MULTIAZ_NONPROD"
  | "IDLE_NAT_GATEWAY"
  | "UNTAGGED_RESOURCE";

export type Severity = "critical" | "high" | "medium" | "low";

export interface DiscoveredAwsResource {
  arn: string;
  resourceId: string;
  service: AwsService;
  region: string;
  name: string;
  state: string;
  tags: Record<string, string>;
  parentResourceId?: string;
  metadata: Record<string, unknown>;
}

export interface PricedResourceSnapshot extends DiscoveredAwsResource {
  projectSlug: string;
  projectLabel: string;
  projectSource: ProjectSource;
  hourlyMicrocents: number;
  monthlyCents: number;
}

export interface ProjectRuleInput {
  ruleType: "arn_override" | "tag_key" | "name_prefix";
  pattern: string;
  projectSlug: string;
  projectLabel: string;
  priority: number;
}

export interface ComputedRuleFinding {
  resourceId: string;
  resourceArn: string;
  projectSlug: string;
  ruleCode: RuleCode;
  severity: Severity;
  title: string;
  description: string;
  estimatedMonthlySavingsCents: number;
  cliCommand: string;
  terraformHint: string;
  keepsAppLive: boolean;
}

export const CostRecommendationActionSchema = z.object({
  title: z.string().min(3).max(160),
  targetResourceId: z.string().min(1).max(256),
  estimatedMonthlySavingsCents: z.number().int().min(0).max(100_000_000),
  riskLevel: z.enum(["low", "medium", "high"]),
  downtimeImpact: z.enum(["zero_downtime", "brief_restart", "scheduled_window"]),
  keepsAppLive: z.boolean(),
  explanation: z.string().min(10).max(600),
  cliCommand: z
    .string()
    .min(6)
    .max(600)
    .refine(isSafeAwsCliCommand, {
      message: "CLI command must be a safe AWS CLI command without shell metacharacters.",
    }),
  terraformSnippet: z
    .string()
    .min(3)
    .max(1500)
    .refine(isSafeTerraformSnippet, {
      message: "Terraform snippet cannot use exec provisioners or destructive commands.",
    }),
});

export const CostRecommendationPlanSchema = z.object({
  summary: z.string().min(10).max(500),
  keepsAppLive: z.boolean(),
  totalEstimatedMonthlySavingsCents: z.number().int().min(0).max(100_000_000),
  actions: z.array(CostRecommendationActionSchema).min(1).max(8),
});

export type CostRecommendationAction = z.infer<typeof CostRecommendationActionSchema>;
export type CostRecommendationPlan = z.infer<typeof CostRecommendationPlanSchema>;

export type AiProviderId = "gemini" | "groq";
export type AiProviderPreference = AiProviderId | "auto";

export function formatCentsUsd(cents: number): string {
  const safeCents = Number.isFinite(cents) ? Math.max(0, Math.round(cents)) : 0;
  const dollars = safeCents / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(dollars);
}

export function formatDailyBurnFromMonthlyCents(monthlyCents: number): string {
  const dailyCents = Math.round(Math.max(0, monthlyCents) / 30);
  return formatCentsUsd(dailyCents);
}

function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function slugifyProject(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === ORPHANED_PROJECT_SLUG) {
    return ORPHANED_PROJECT_SLUG;
  }

  const cleaned = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!cleaned) {
    return `project-${fnv1aHex(trimmed.toLowerCase())}`;
  }

  return cleaned;
}

export function humanizeProjectLabel(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return ORPHANED_PROJECT_LABEL;
  if (/[A-Z]/.test(trimmed)) return trimmed;
  return trimmed
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
