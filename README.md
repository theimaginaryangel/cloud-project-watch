# CloudProjectWatch

Track AWS spending by project, find untagged or idle resources, and lower your monthly bill without running `terraform destroy` on live apps.

## Why this exists

AWS groups bills by service (RDS, EC2, Secrets Manager) instead of by project. When you host multiple apps in one AWS account, a failed deploy can quietly leave an RDS instance, NAT Gateway, or unattached Elastic IP running for weeks.

CloudProjectWatch checks your live AWS resources using free `Describe*` and `ResourceGroupsTaggingAPI` calls, estimates monthly spend from exact integer pricing rates, groups everything by project, and links straight to each resource in the AWS Console.

## What it does

- **Free live scanning:** Reads EC2, EBS, Elastic IPs, NAT Gateways, RDS, Secrets Manager, and ALB/NLB without polling the paid Cost Explorer API.
- **Retroactive project grouping:** Works on existing AWS accounts with zero setup beforehand. Groups resources by saved overrides, existing tags (`Project`, `app`, `aws:cloudformation:stack-name`), name prefixes (`cloudpress-*`), and parent attachments (such as an EBS volume mounted to an EC2 instance). Everything else lands under `Untagged`.
- **Automatic checks:** Flags unattached Elastic IPs, unused EBS volumes, stopped RDS instances approaching AWS's 7-day auto-restart, static Secrets Manager entries that can move to free SSM Parameter Store, over-provisioned RDS IOPS, non-prod Multi-AZ databases, and running NAT Gateways.
- **Optional Gemini and Groq suggestions (BYOK):** Bring your own Gemini key, Groq key, or both (with automatic fallback and snapshot caching) for non-destructive AWS CLI and Terraform steps.
- **Read-only by design:** Never requests write or delete permissions. Every item includes a copyable CLI command and a direct link to open it in the AWS Console.
- **24-hour Cost Explorer lock:** Optional actual MTD reconciliation via `ce:GetCostAndUsage` is disabled by default and locked in PostgreSQL to at most 1 call every 24 hours (max $0.30/month).

## Quick start

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ftheimaginaryangel%2Fcloud-project-watch&env=DATABASE_URL,APP_ENCRYPTION_KEY,OWNER_PASSWORD)

CloudProjectWatch ships with an embedded local PostgreSQL database (`PGlite`) and demo data so you can run it immediately without Docker.

```bash
git clone https://github.com/theimaginaryangel/cloud-project-watch.git
cd cloud-project-watch
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:3000`.

### Deployment & Key Security

Each self-hosted user owns their own PostgreSQL database and `APP_ENCRYPTION_KEY`. Keys saved in Settings are encrypted with AES-256-GCM and are never returned to the browser.

- **Private personal deployment:** Set `DATABASE_URL` (Neon/Supabase), `APP_ENCRYPTION_KEY`, `DEMO_MODE="false"`, and `OWNER_PASSWORD` (enables HTTP Basic Auth across all routes).
- **Public portfolio demo:** Set `DEMO_MODE="true"` and `PUBLIC_DEMO_LOCK="true"` so visitors can explore every screen freely while key/settings mutations are blocked (`403`).

### Using PostgreSQL (Docker, Neon, or Supabase)

```bash
# Local Docker Postgres
docker compose up -d
# Set DATABASE_URL="postgresql://cpw:cpw@localhost:5432/cloudprojectwatch" in .env

# Or Neon / Supabase
# Set DATABASE_URL="postgresql://user:pass@host/db?sslmode=require" in .env
```

## Connecting your AWS account

1. Open **Settings** (`/settings`) and switch to **Read-only IAM keys** (or **Local AWS CLI**).
2. Download [infra/readonly-iam.yaml](infra/readonly-iam.yaml) to create a read-only IAM user in CloudFormation, or copy the minimal JSON policy directly from Settings.
3. Paste your read-only keys (encrypted at rest using AES-256-GCM) and click **Test connection** followed by **Save & scan**.

## Tests and build

```bash
npm test
npm run typecheck
npm run build
```

## License

MIT. See [LICENSE](LICENSE).
