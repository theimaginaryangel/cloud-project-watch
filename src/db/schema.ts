import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const awsConnections = pgTable("aws_connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().default("Primary AWS"),
  mode: text("mode", { enum: ["demo", "iam_keys", "env_default"] })
    .notNull()
    .default("demo"),
  regions: text("regions")
    .array()
    .notNull()
    .default(sql`ARRAY['us-east-1', 'us-east-2', 'us-west-2']::text[]`),
  encryptedCredentials: text("encrypted_credentials"),
  costExplorerEnabled: boolean("cost_explorer_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const aiProviderConfigs = pgTable(
  "ai_provider_configs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider", { enum: ["gemini", "groq"] }).notNull(),
    encryptedApiKey: text("encrypted_api_key"),
    modelId: text("model_id").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    fallbackEnabled: boolean("fallback_enabled").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("ai_provider_configs_provider_uidx").on(table.provider)],
);

export const projectRules = pgTable(
  "project_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => awsConnections.id, { onDelete: "cascade" }),
    ruleType: text("rule_type", {
      enum: ["arn_override", "tag_key", "name_prefix"],
    }).notNull(),
    pattern: text("pattern").notNull(),
    projectSlug: text("project_slug").notNull(),
    projectLabel: text("project_label").notNull(),
    priority: integer("priority").notNull().default(100),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("project_rules_conn_type_pattern_uidx").on(
      table.connectionId,
      table.ruleType,
      table.pattern,
    ),
  ],
);

export const scanRuns = pgTable(
  "scan_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => awsConnections.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status", { enum: ["running", "completed", "failed"] })
      .notNull()
      .default("running"),
    regionsScanned: text("regions_scanned")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    resourceCount: integer("resource_count").notNull().default(0),
    totalMonthlyCents: bigint("total_monthly_cents", { mode: "number" }).notNull().default(0),
    potentialSavingsCents: bigint("potential_savings_cents", { mode: "number" })
      .notNull()
      .default(0),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("scan_runs_idempotency_uidx").on(table.idempotencyKey),
    uniqueIndex("scan_runs_one_running_per_conn_uidx")
      .on(table.connectionId)
      .where(sql`${table.status} = 'running'`),
    check("scan_runs_total_monthly_nonneg", sql`${table.totalMonthlyCents} >= 0`),
    check("scan_runs_potential_savings_nonneg", sql`${table.potentialSavingsCents} >= 0`),
    check("scan_runs_resource_count_nonneg", sql`${table.resourceCount} >= 0`),
  ],
);

export const awsResources = pgTable(
  "aws_resources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scanRunId: uuid("scan_run_id")
      .notNull()
      .references(() => scanRuns.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => awsConnections.id, { onDelete: "cascade" }),
    arn: text("arn").notNull(),
    resourceId: text("resource_id").notNull(),
    service: text("service", {
      enum: ["ec2", "ebs", "eip", "nat_gateway", "rds", "secrets_manager", "elb"],
    }).notNull(),
    region: text("region").notNull(),
    name: text("name").notNull(),
    state: text("state").notNull(),
    projectSlug: text("project_slug").notNull(),
    projectLabel: text("project_label").notNull(),
    projectSource: text("project_source", {
      enum: ["override", "tag", "prefix", "parent", "orphaned"],
    }).notNull(),
    hourlyMicrocents: bigint("hourly_microcents", { mode: "number" }).notNull().default(0),
    monthlyCents: bigint("monthly_cents", { mode: "number" }).notNull().default(0),
    tagsJson: jsonb("tags_json").$type<Record<string, string>>().notNull().default({}),
    metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>().notNull().default({}),
    scannedAt: timestamp("scanned_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("aws_resources_hourly_nonneg", sql`${table.hourlyMicrocents} >= 0`),
    check("aws_resources_monthly_nonneg", sql`${table.monthlyCents} >= 0`),
  ],
);

export const ruleFindings = pgTable(
  "rule_findings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scanRunId: uuid("scan_run_id")
      .notNull()
      .references(() => scanRuns.id, { onDelete: "cascade" }),
    resourceId: text("resource_id").notNull(),
    resourceArn: text("resource_arn").notNull(),
    projectSlug: text("project_slug").notNull(),
    ruleCode: text("rule_code", {
      enum: [
        "UNATTACHED_EIP",
        "ORPHANED_EBS",
        "RDS_7DAY_AUTORESTART",
        "SECRETS_TO_SSM",
        "RDS_PROVISIONED_IOPS",
        "RDS_MULTIAZ_NONPROD",
        "IDLE_NAT_GATEWAY",
        "UNTAGGED_RESOURCE",
      ],
    }).notNull(),
    severity: text("severity", { enum: ["critical", "high", "medium", "low"] }).notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    estimatedMonthlySavingsCents: bigint("estimated_monthly_savings_cents", { mode: "number" })
      .notNull()
      .default(0),
    cliCommand: text("cli_command").notNull(),
    terraformHint: text("terraform_hint").notNull(),
    keepsAppLive: boolean("keeps_app_live").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("rule_findings_savings_nonneg", sql`${table.estimatedMonthlySavingsCents} >= 0`),
  ],
);

export const aiRecommendations = pgTable(
  "ai_recommendations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => awsConnections.id, { onDelete: "cascade" }),
    projectSlug: text("project_slug").notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    provider: text("provider", { enum: ["gemini", "groq"] }).notNull(),
    modelId: text("model_id").notNull(),
    planJson: jsonb("plan_json").notNull(),
    estimatedMonthlySavingsCents: bigint("estimated_monthly_savings_cents", { mode: "number" })
      .notNull()
      .default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ai_recs_conn_proj_hash_provider_uidx").on(
      table.connectionId,
      table.projectSlug,
      table.snapshotHash,
      table.provider,
    ),
    check("ai_recs_savings_nonneg", sql`${table.estimatedMonthlySavingsCents} >= 0`),
  ],
);

export const costExplorerSyncs = pgTable(
  "cost_explorer_syncs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => awsConnections.id, { onDelete: "cascade" }),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    actualMtdCents: bigint("actual_mtd_cents", { mode: "number" }).notNull().default(0),
    byServiceJson: jsonb("by_service_json").$type<Record<string, number>>().notNull().default({}),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [check("ce_syncs_actual_mtd_nonneg", sql`${table.actualMtdCents} >= 0`)],
);
