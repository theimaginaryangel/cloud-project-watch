# 03 - App Flow

## Routes
1. `/` - Overview: dismissible frosted notification strip, monthly spend summary, Scan AWS button, grouped Projects list with spend bars, and top items worth checking.
2. `/projects/[slug]` - Project Detail: on-demand Gemini/Groq cost recommendations, automatic checks, live resource list with 1-click Open in AWS Console links, and Terraform `default_tags` starter block.
3. `/untagged` - Untagged & Idle: filterable list with local "Assign to project", copyable AWS `tag-resources` CLI, and 1-click Open in AWS Console links.
4. `/settings` - Settings: (1) AWS account connection & CloudFormation read-only template, (2) Gemini & Groq API keys, (3) Project grouping rules & 24h Cost Explorer toggle.
