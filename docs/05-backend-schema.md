# 05 — Backend Schema & System Invariants

## Unbreakable Business Invariants
1. **No Cost Explorer Runaway Spend:** `cost_explorer_syncs` enforces a DB-locked 24h cooldown per connection before invoking `ce:GetCostAndUsage`.
2. **No Concurrent Duplicate Scans:** Partial unique index `UNIQUE (connection_id) WHERE status = 'running'` on `scan_runs` plus `UNIQUE (idempotency_key)`.
3. **Exact Integer Money Math:** Every monetary column uses `BIGINT` (`hourly_microcents`, `monthly_cents`, `estimated_monthly_savings_cents`) with `CHECK (>= 0)` and explicit UTC `TIMESTAMPTZ`.
4. **Encrypted BYOK Secrets:** Raw AWS/Gemini/Groq keys are encrypted with AES-256-GCM before storage and never returned in API responses.
5. **No Silently Dropped Resources:** Unmatched resources always land in `project_slug = '__orphaned__'`.
