# 02 — Technical Requirements Document (TRD)

- **Framework:** Next.js 15 (App Router, TypeScript strict mode) configured as a mobile-first PWA (`app/manifest.ts`).
- **UI Foundation (1 only):** `shadcn/ui` (Tailwind CSS v4 + Radix primitives).
- **UI Accents (1–2 max):** `motion` (Apple-restrained press/layout transitions) + `recharts` (via shadcn Chart).
- **Database:** PostgreSQL 16 (local `docker-compose.yml` or Neon/Supabase free tier) via `drizzle-orm` + `postgres`.
- **AWS Integration:** Modular AWS SDK v3 (`@aws-sdk/client-ec2`, `rds`, `secrets-manager`, `elastic-load-balancing-v2`, `resource-groups-tagging-api`, `sts`, optional `cost-explorer`).
- **AI Providers (BYOK):** `@google/genai` (Gemini) + `groq-sdk` (Groq) behind one `AiAdvisorProvider` contract + Zod structured output validation.
- **Security:** AES-256-GCM encryption for BYOK keys stored in Postgres; strictly read-only AWS IAM in v1; explicit `AbortSignal.timeout(15000)` on all external calls.
