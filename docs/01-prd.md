# 01 — Product Requirements Document (PRD)

## Problem & Target User
Indie engineers, agencies, and small cloud teams run multiple apps in one AWS account. AWS groups bills by service (RDS, EC2, Secrets Manager), not by project, and half-failed Terraform deployments silently leave orphaned resources burning $100–$400/mo. Running `terraform destroy` kills live portfolio demos and production apps.

## Core Message (≤ 2-Minute Comprehension)
**See which AWS project is burning money, catch untagged zombies automatically, and cut cost surgically without taking your live apps offline.**

## MVP Scope (v1 — Strictly Read-Only)
1. **Zero-Cost Discovery:** Scan live EC2, EBS, EIP, NAT Gateway, RDS, Secrets Manager, and ALB/NLB resources via free `Describe*` + `ResourceGroupsTaggingAPI`.
2. **Retroactive Project Grouping:** 4-layer cascade (`arn_override` → `tag_key` incl. `aws:cloudformation:stack-name` → `name_prefix` & parent attachment → `__orphaned__`).
3. **Instant $0 Zombie Rule Engine:** Catch 8 high-value waste patterns immediately on every scan.
4. **Dual BYOK AI Surgical Advisor:** Generate non-destructive optimization plans using user's **Gemini** and/or **Groq** API keys (with auto-fallback and snapshot-hash caching).
5. **Zero-Friction Onboarding + Demo Mode:** 1-click CloudFormation read-only IAM template, copyable IAM Policy JSON, copyable `tag-resources` & Terraform `default_tags` snippets, plus preloaded Demo Mode.
6. **Optional 24h Cost Explorer Sync:** Hard-capped at 1 request per 24 hours (`max $0.30/mo`).
