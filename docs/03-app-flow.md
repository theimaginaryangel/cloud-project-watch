# 03 — App Flow

## Routes
1. `/` — Overview Dashboard: KPI strip, Scan Now button, pinned Orphan/RDS 7-Day alert banner, burn-by-project chart, and project cards.
2. `/projects/[slug]` — Project Deep Dive: service burn breakdown, live resource table, instant rule findings (with copyable AWS CLI / Terraform commands), and on-demand Gemini/Groq Surgical Plan panel.
3. `/zombies` — Orphan & Zombie Inbox: filterable triage list with 1-click local "Assign to Project", copyable AWS `tag-resources` CLI, and Terraform `default_tags` snippet.
4. `/settings` — 3-Step Setup Wizard: (1) Demo vs Live Read-Only AWS connection + 1-click CloudFormation template, (2) BYOK Gemini & Groq keys + Verify, (3) Project grouping rules + 24h Cost Explorer guard.

## Resilience States
Every view implements Loading (`Skeleton`), Empty (`Empty`), Error (`Alert` + retry), and Success states, plus synchronous ref-locked submit buttons to prevent double-clicks.
