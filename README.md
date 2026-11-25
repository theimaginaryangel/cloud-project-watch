# TagWatch

**Track AWS burn by project, catch untagged zombie resources automatically, and cut cloud costs surgically without running `terraform destroy`.**

Built after a half-failed Terraform deployment silently left orphaned RDS and Secrets Manager resources burning \$400 in the background. TagWatch keeps your live apps and portfolio demos online while showing you exactly how to slash waste.

---

## Why TagWatch?

AWS groups bills by **service** (`RDS`, `EC2`, `Secrets Manager`), not by **project** (`CloudPress` vs `Kaluna` vs `BankGuard`). And polling AWS Cost Explorer (`ce:GetCostAndUsage`) costs **\$0.01 per request**—naive dashboard polling can burn thousands of dollars just checking your bill.

TagWatch solves both problems:

1. **\$0/month Live Discovery:** Scans running EC2, EBS, Elastic IPs, NAT Gateways, RDS, Secrets Manager, and ALB/NLB using strictly free `Describe*` / `List*` / `ResourceGroupsTaggingAPI` endpoints + an integer-microcent pricing engine.
2. **Retroactive 4-Layer Project Grouping:** Works on existing AWS accounts with zero pre-setup:
   `Saved Overrides → Existing AWS Tags (Project, app, CloudFormation stack) → Name Prefixes & Parent Attachments → Red "Untagged / Orphaned" Inbox`.
3. **Instant \$0 Zombie Rule Engine:** Automatically catches unattached EIPs, orphaned EBS volumes, stopped RDS 7-day auto-restart countdowns, non-rotating Secrets Manager secrets (→ free SSM Parameter Store), over-provisioned RDS IOPS (→ baseline `gp3`), non-prod Multi-AZ, and idle NAT Gateways.
4. **Dual BYOK AI Surgical Advisor (Gemini + Groq):** Bring your own **Google Gemini** and/or **Groq** API key (with automatic fallback and snapshot-hash caching) for tailored, non-destructive AWS CLI and Terraform optimization playbooks.
5. **Strictly Read-Only in v1:** TagWatch cannot modify or delete your infrastructure. It gives you 1-click copyable CLI and Terraform commands you review and run yourself.

---

## Quick Start (30 Seconds — Zero Docker Required)

TagWatch ships in **Demo Mode** with an embedded local PostgreSQL engine (`PGlite`) so you can run it immediately, and scales seamlessly to **Neon**, **Supabase**, or **Docker Postgres** by changing `DATABASE_URL`.

```bash
git clone <your-repo-url> tagwatch
cd tagwatch
cp .env.example .env
npm install
npm run dev
```

Open **http://localhost:3000** — Demo Mode automatically loads `CloudPress`, `Kaluna`, `BankGuard`, and an `Untagged / Orphaned` zombie bucket so you can explore every screen right away.

### Using Docker Postgres or Neon / Supabase

```bash
# Option A: Local Docker Postgres
docker compose up -d
# Then set DATABASE_URL="postgresql://tagwatch:tagwatch@localhost:5432/tagwatch" in .env

# Option B: Free Neon or Supabase Postgres
# Set DATABASE_URL="postgresql://user:pass@host/db?sslmode=require" in .env
```

---

## Connecting Your Real AWS Account (Strictly Read-Only)

1. Open **Connect & Keys (`/settings`)** inside TagWatch.
2. Download the 1-click CloudFormation template ([infra/readonly-iam.yaml](infra/readonly-iam.yaml)) or copy the minimal Read-Only IAM Policy JSON.
3. Deploy the stack in AWS CloudFormation to create a read-only `tagwatch-readonly` IAM user, generate an Access Key, and paste it into **Step 1: Connect AWS** (encrypted at rest using AES-256-GCM).
4. Click **Test Connection** → **Save & Scan Now**.

> **Cost Explorer Guardrail:** Optional actual MTD reconciliation via `ce:GetCostAndUsage` is disabled by default and hard-locked in PostgreSQL to **at most 1 call per 24 hours** (max \$0.30/month).

---

## Bring Your Own AI Keys (Gemini + Groq)

In **Connect & Keys → 2. AI Keys** (or in `.env`):
- Add a **Google Gemini** API key (`GEMINI_API_KEY`)
- Add a **Groq** API key (`GROQ_API_KEY`)
- Or add **both** and enable **Auto (Gemini → Groq)** fallback so rate limits never interrupt an analysis.

---

## Development & Verification

```bash
npm test          # Unit tests + real PostgreSQL concurrency, idempotency & 24h guard tests
npm run typecheck # Strict TypeScript check
npm run build     # Production Next.js build
```

## License

MIT — see [LICENSE](LICENSE).
