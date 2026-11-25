export const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS aws_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT 'Primary AWS',
  mode text NOT NULL DEFAULT 'demo',
  regions text[] NOT NULL DEFAULT ARRAY['us-east-1', 'us-east-2', 'us-west-2']::text[],
  encrypted_credentials text,
  cost_explorer_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_provider_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  encrypted_api_key text,
  model_id text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  fallback_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_provider_configs_provider_uidx
  ON ai_provider_configs (provider);

CREATE TABLE IF NOT EXISTS project_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES aws_connections(id) ON DELETE CASCADE,
  rule_type text NOT NULL,
  pattern text NOT NULL,
  project_slug text NOT NULL,
  project_label text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS project_rules_conn_type_pattern_uidx
  ON project_rules (connection_id, rule_type, pattern);

CREATE TABLE IF NOT EXISTS scan_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES aws_connections(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  regions_scanned text[] NOT NULL DEFAULT ARRAY[]::text[],
  resource_count integer NOT NULL DEFAULT 0 CHECK (resource_count >= 0),
  total_monthly_cents bigint NOT NULL DEFAULT 0 CHECK (total_monthly_cents >= 0),
  potential_savings_cents bigint NOT NULL DEFAULT 0 CHECK (potential_savings_cents >= 0),
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS scan_runs_idempotency_uidx
  ON scan_runs (idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS scan_runs_one_running_per_conn_uidx
  ON scan_runs (connection_id)
  WHERE status = 'running';

CREATE TABLE IF NOT EXISTS aws_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_run_id uuid NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES aws_connections(id) ON DELETE CASCADE,
  arn text NOT NULL,
  resource_id text NOT NULL,
  service text NOT NULL,
  region text NOT NULL,
  name text NOT NULL,
  state text NOT NULL,
  project_slug text NOT NULL,
  project_label text NOT NULL,
  project_source text NOT NULL,
  hourly_microcents bigint NOT NULL DEFAULT 0 CHECK (hourly_microcents >= 0),
  monthly_cents bigint NOT NULL DEFAULT 0 CHECK (monthly_cents >= 0),
  tags_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  scanned_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rule_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_run_id uuid NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  resource_id text NOT NULL,
  resource_arn text NOT NULL,
  project_slug text NOT NULL,
  rule_code text NOT NULL,
  severity text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  estimated_monthly_savings_cents bigint NOT NULL DEFAULT 0 CHECK (estimated_monthly_savings_cents >= 0),
  cli_command text NOT NULL,
  terraform_hint text NOT NULL,
  keeps_app_live boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES aws_connections(id) ON DELETE CASCADE,
  project_slug text NOT NULL,
  snapshot_hash text NOT NULL,
  provider text NOT NULL,
  model_id text NOT NULL,
  plan_json jsonb NOT NULL,
  estimated_monthly_savings_cents bigint NOT NULL DEFAULT 0 CHECK (estimated_monthly_savings_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_recs_conn_proj_hash_provider_uidx
  ON ai_recommendations (connection_id, project_slug, snapshot_hash, provider);

CREATE TABLE IF NOT EXISTS cost_explorer_syncs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES aws_connections(id) ON DELETE CASCADE,
  period_start text NOT NULL,
  period_end text NOT NULL,
  actual_mtd_cents bigint NOT NULL DEFAULT 0 CHECK (actual_mtd_cents >= 0),
  by_service_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now()
);
`;
