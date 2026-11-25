# 01 - Product Requirements Document (PRD)

## Problem & Target User
Indie engineers, agencies, and small cloud teams run multiple apps in one AWS account. AWS groups bills by service (RDS, EC2, Secrets Manager), not by project, and incomplete deploys can quietly leave unused resources running. Running `terraform destroy` takes live demos and production apps offline.

## Core Message
See which AWS project is costing money, spot untagged or idle resources, and reduce your monthly bill without shutting down running apps.

## MVP Scope (v1 - Read-Only)
1. **Free Discovery:** Scan live EC2, EBS, EIP, NAT Gateway, RDS, Secrets Manager, and ALB/NLB resources via free `Describe*` and `ResourceGroupsTaggingAPI`.
2. **Retroactive Project Grouping:** 4-layer cascade (`arn_override` -> `tag_key` incl. `aws:cloudformation:stack-name` -> `name_prefix` & parent attachment -> `__orphaned__`).
3. **Automatic Checks:** Catch 8 common idle/over-provisioned patterns on every scan at $0 cost.
4. **Optional Gemini and Groq Suggestions (BYOK):** Generate non-destructive AWS CLI and Terraform recommendations using user's own Gemini and/or Groq API keys (with fallback and snapshot caching).
5. **Read-Only Onboarding + Demo Mode:** Downloadable CloudFormation read-only IAM template, minimal IAM Policy JSON, 1-click Open in AWS Console links, copyable `tag-resources` & Terraform `default_tags` snippets, and built-in demo data.
6. **Optional 24h Cost Explorer Sync:** Hard-capped at 1 request per 24 hours (max $0.30/month).
