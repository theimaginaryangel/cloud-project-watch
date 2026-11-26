# CloudProjectWatch State

- **Status:** v1.1 Hardened — Full Security & Concurrency Remediation Completed (`theimaginaryangel/cloud-project-watch`)
- **Routes:** `/`, `/projects/[slug]`, `/untagged`, `/settings`
- **Security Posture:**
  - Fail-closed `OWNER_PASSWORD` Basic Auth in production (`charset="UTF-8"` safe Base64 + SHA-256 constant-time compare + brute-force rate limiting)
  - CSRF `Origin` / `Sec-Fetch-Site` + `Content-Type: application/json` enforcement on all mutating endpoints
  - AES-256-GCM BYOK encryption rejecting known/weak keys + explicit `ALLOW_AMBIENT_AWS_CREDENTIALS` opt-in gate for `env_default`
  - POSIX single-quote CLI escaping, HCL interpolation escaping, and strict Zod allowlist validation on AI-generated AWS CLI / Terraform snippets
  - CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, and `Strict-Transport-Security` headers
- **Reliability & Data Invariants:**
  - Singleton primary AWS connection (`aws_connections_singleton_uidx`) + resilient DB bootstrap promise recovery
  - Stale `running` scan auto-expiration (`3m`) + exact per-resource savings cap + non-blocking Cost Explorer `PENDING` intent reservation (`24h` cooldown)
  - Paginated AWS SDK v3 discovery + SQL-filtered project detail queries
