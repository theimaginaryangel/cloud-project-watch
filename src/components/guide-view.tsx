"use client";

import { ArrowLeft, ChevronDown, Download, ExternalLink } from "lucide-react";
import Link from "next/link";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";

const LOCAL_START_CMD = `git clone https://github.com/theimaginaryangel/cloud-project-watch.git
cd cloud-project-watch
cp .env.example .env
npm install
npm run dev`;

const GEN_KEY_CMD = `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`;

const FAQS = [
  {
    q: "Do I need this installed before creating my AWS projects?",
    a: "No. It works on accounts that already have projects running. When you scan, it checks existing tags (Project, app, CloudFormation stack names), name prefixes like cloudpress-*, and attached resources like EBS volumes mounted to an EC2 instance. Anything left over goes to Untagged so you can assign or clean it up.",
  },
  {
    q: "Will scanning my account add to my AWS bill?",
    a: "No. Every scan uses free AWS Describe, List, and ResourceGroupsTaggingAPI calls. Cost Explorer ($0.01 per request) is turned off by default, and if you turn it on in Settings, the database blocks it from running more than once every 24 hours (max $0.30/month).",
  },
  {
    q: "Where are my AWS and AI keys stored?",
    a: "When you self-host, your keys are encrypted with AES-256-GCM using your own APP_ENCRYPTION_KEY and saved inside your own Postgres database. If you run locally, you can also pick Local AWS CLI so no AWS keys are saved in the database at all. The public demo site runs in memory with no database and blocks saving keys.",
  },
  {
    q: "Can CloudProjectWatch stop or delete my AWS resources?",
    a: "No. The IAM policy is strictly read-only. For every suggestion or idle item, it gives you a CLI command to review and a link that opens that exact resource in the AWS Console.",
  },
] as const;

export function GuideView() {
  return (
    <div className="flex flex-col gap-10">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit"
        >
          <ArrowLeft className="size-3.5" />
          <span>Overview</span>
        </Link>

        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">How to use CloudProjectWatch</h1>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
            AWS bills you by service (RDS, EC2, Secrets Manager), not by project.
            CloudProjectWatch reads what is running in your account, groups it by project,
            and shows ways to lower your monthly bill without shutting down live apps.
          </p>
        </div>
      </div>

      {/* Section 1: How it works */}
      <section className="flex flex-col gap-3">
        <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          How it works
        </h2>
        <div className="glass-panel rounded-2xl overflow-hidden hairline-divide">
          <div className="px-6 py-5 flex flex-col gap-1">
            <span className="text-sm font-medium">1. Scan your account ($0)</span>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Click Scan AWS to list live EC2 instances, EBS volumes, Elastic IPs, NAT Gateways,
              RDS databases, Secrets Manager entries, and load balancers using free AWS read APIs.
            </p>
          </div>
          <div className="px-6 py-5 flex flex-col gap-1">
            <span className="text-sm font-medium">2. Group by project</span>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Resources are grouped in order: your saved assignments, existing AWS tags, name
              prefixes, and parent attachments. Anything without a match appears under Untagged.
            </p>
          </div>
          <div className="px-6 py-5 flex flex-col gap-1">
            <span className="text-sm font-medium">3. Lower the bill without breaking live apps</span>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Open any project to see automatic checks and optional Gemini or Groq suggestions.
              Copy the AWS CLI or Terraform change, or click Open in AWS Console to adjust it yourself.
            </p>
          </div>
        </div>
      </section>

      {/* Section 2: Connect AWS */}
      <section className="flex flex-col gap-3">
        <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Connect your AWS account
        </h2>
        <div className="glass-panel rounded-2xl p-6 flex flex-col gap-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Use a read-only IAM user so the app can check your resources without any permission
            to edit or delete them.
          </p>
          <ol className="flex flex-col gap-2 text-sm text-foreground list-decimal list-inside">
            <li>Download the read-only CloudFormation template below and upload it in AWS CloudFormation.</li>
            <li>Open the new IAM user in AWS, go to Security credentials, and create an access key.</li>
            <li>Open Settings, pick Read-only IAM keys, paste the keys, and click Save &amp; scan.</li>
          </ol>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button variant="outline" size="sm" asChild className="rounded-full">
              <a href="/api/templates/readonly-iam" download>
                <Download data-icon="inline-start" />
                Download CloudFormation template
              </a>
            </Button>
            <Button variant="ghost" size="sm" asChild className="rounded-full">
              <Link href="/settings">Open Settings</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Section 3: Run your own copy */}
      <section className="flex flex-col gap-3">
        <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Host your own private copy
        </h2>
        <div className="glass-panel rounded-2xl overflow-hidden hairline-divide">
          <div className="p-6 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">Option A: Deploy on Vercel + Neon ($0/month)</span>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Create a free Postgres database on Neon, then deploy your own copy on Vercel with
                three environment variables: <code className="font-mono text-xs">DATABASE_URL</code>,{" "}
                <code className="font-mono text-xs">APP_ENCRYPTION_KEY</code>, and{" "}
                <code className="font-mono text-xs">OWNER_PASSWORD</code>. Setting{" "}
                <code className="font-mono text-xs">OWNER_PASSWORD</code> locks the site so only you
                can open it.
              </p>
            </div>

            <div className="rounded-xl bg-secondary/70 p-4 flex flex-col gap-3">
              <span className="text-xs text-muted-foreground">
                Generate your encryption key locally:
              </span>
              <code className="text-xs font-mono break-all whitespace-pre-wrap">
                {GEN_KEY_CMD}
              </code>
              <div>
                <CopyButton value={GEN_KEY_CMD} label="Copy command" />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" asChild className="rounded-full press-feedback">
                <a
                  href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ftheimaginaryangel%2Fcloud-project-watch&env=DATABASE_URL,APP_ENCRYPTION_KEY,OWNER_PASSWORD"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Deploy on Vercel
                  <ExternalLink data-icon="inline-end" />
                </a>
              </Button>
              <Button variant="ghost" size="sm" asChild className="rounded-full">
                <a
                  href="https://github.com/theimaginaryangel/cloud-project-watch"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View GitHub repo
                  <ExternalLink data-icon="inline-end" />
                </a>
              </Button>
            </div>
          </div>

          <div className="p-6 flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">Option B: Run locally on your computer</span>
              <p className="text-sm text-muted-foreground">
                Works out of the box with no Docker required. You can use your local{" "}
                <code className="font-mono text-xs">~/.aws/credentials</code> profile directly.
              </p>
            </div>
            <div className="rounded-xl bg-secondary/70 p-4 flex flex-col gap-3">
              <pre className="text-xs font-mono whitespace-pre-wrap break-all leading-relaxed">
                <code>{LOCAL_START_CMD}</code>
              </pre>
              <div>
                <CopyButton value={LOCAL_START_CMD} label="Copy setup commands" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Section 4: Common questions */}
      <section className="flex flex-col gap-3">
        <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Common questions
        </h2>
        <div className="glass-panel rounded-2xl overflow-hidden hairline-divide">
          {FAQS.map((item) => (
            <details key={item.q} className="group">
              <summary className="list-none cursor-pointer px-6 py-4 flex items-center justify-between gap-4 hover:bg-secondary/50 transition-colors">
                <span className="text-sm font-medium text-foreground">{item.q}</span>
                <ChevronDown className="size-4 text-muted-foreground shrink-0 transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-6 pb-5 pt-1">
                <p className="text-sm text-muted-foreground leading-relaxed">{item.a}</p>
              </div>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
