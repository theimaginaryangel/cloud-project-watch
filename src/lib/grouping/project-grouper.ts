import {
  ORPHANED_PROJECT_LABEL,
  ORPHANED_PROJECT_SLUG,
  humanizeProjectLabel,
  slugifyProject,
  type DiscoveredAwsResource,
  type PricedResourceSnapshot,
  type ProjectRuleInput,
  type ProjectSource,
} from "@/lib/domain/types";
import { estimateResourceCost } from "@/lib/pricing/aws-rates";

export const DEFAULT_TAG_KEYS = [
  "Project",
  "project",
  "app",
  "Application",
  "Stack",
  "aws:cloudformation:stack-name",
] as const;

interface GroupMatch {
  projectSlug: string;
  projectLabel: string;
  projectSource: ProjectSource;
}

function matchOverride(
  resource: DiscoveredAwsResource,
  overrideRules: ProjectRuleInput[],
): GroupMatch | null {
  for (const rule of overrideRules) {
    if (rule.pattern === resource.arn || rule.pattern === resource.resourceId) {
      return {
        projectSlug: slugifyProject(rule.projectSlug),
        projectLabel: rule.projectLabel,
        projectSource: "override",
      };
    }
  }
  return null;
}

function matchTag(
  resource: DiscoveredAwsResource,
  customTagKeys: string[],
): GroupMatch | null {
  const orderedKeys = [...customTagKeys, ...DEFAULT_TAG_KEYS];
  const lowerTags = new Map<string, string>();
  for (const [key, value] of Object.entries(resource.tags)) {
    if (value.trim().length > 0) {
      lowerTags.set(key.toLowerCase(), value.trim());
    }
  }

  for (const key of orderedKeys) {
    const exact = resource.tags[key]?.trim();
    const matchedValue = exact || lowerTags.get(key.toLowerCase());
    if (matchedValue) {
      return {
        projectSlug: slugifyProject(matchedValue),
        projectLabel: humanizeProjectLabel(matchedValue),
        projectSource: "tag",
      };
    }
  }

  return null;
}

function matchPrefix(
  resource: DiscoveredAwsResource,
  prefixRules: ProjectRuleInput[],
): GroupMatch | null {
  const nameLower = resource.name.toLowerCase();
  const idLower = resource.resourceId.toLowerCase();

  for (const rule of prefixRules) {
    const cleaned = rule.pattern.toLowerCase().replace(/\*+$/, "");
    if (!cleaned) continue;
    if (nameLower.startsWith(cleaned) || idLower.startsWith(cleaned)) {
      return {
        projectSlug: slugifyProject(rule.projectSlug),
        projectLabel: rule.projectLabel,
        projectSource: "prefix",
      };
    }
  }

  return null;
}

/**
 * Retroactive 4-layer grouping cascade:
 * 1. Explicit ARN/ID override saved in CloudProjectWatch
 * 2. Existing AWS tags (Project, app, aws:cloudformation:stack-name, custom keys)
 * 3. Configured name prefixes (e.g., cloudpress-*)
 * 4. Parent resource inheritance (e.g., EBS volume or EIP attached to a grouped EC2 instance)
 * 5. Fallback -> __orphaned__ ("Untagged / Orphaned")
 */
export function groupAndPriceResources(
  resources: DiscoveredAwsResource[],
  rules: ProjectRuleInput[],
): PricedResourceSnapshot[] {
  const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);
  const overrideRules = sortedRules.filter((r) => r.ruleType === "arn_override");
  const customTagKeys = sortedRules
    .filter((r) => r.ruleType === "tag_key")
    .map((r) => r.pattern);
  const prefixRules = sortedRules.filter((r) => r.ruleType === "name_prefix");

  const firstPassMatches = new Map<string, GroupMatch>();

  for (const resource of resources) {
    const match =
      matchOverride(resource, overrideRules) ??
      matchTag(resource, customTagKeys) ??
      matchPrefix(resource, prefixRules);

    if (match) {
      firstPassMatches.set(resource.resourceId, match);
    }
  }

  return resources.map((resource) => {
    let match = firstPassMatches.get(resource.resourceId) ?? null;

    if (!match && resource.parentResourceId) {
      const parentMatch = firstPassMatches.get(resource.parentResourceId);
      if (parentMatch) {
        match = {
          projectSlug: parentMatch.projectSlug,
          projectLabel: parentMatch.projectLabel,
          projectSource: "parent",
        };
      }
    }

    const resolved: GroupMatch = match ?? {
      projectSlug: ORPHANED_PROJECT_SLUG,
      projectLabel: ORPHANED_PROJECT_LABEL,
      projectSource: "orphaned",
    };

    const cost = estimateResourceCost(resource);

    return {
      ...resource,
      projectSlug: resolved.projectSlug,
      projectLabel: resolved.projectLabel,
      projectSource: resolved.projectSource,
      hourlyMicrocents: cost.hourlyMicrocents,
      monthlyCents: cost.monthlyCents,
    };
  });
}

export function buildTagResourcesCli(arns: string[], projectName: string, region = "us-east-1"): string {
  const safeArns = arns.map((arn) => `"${arn}"`).join(" ");
  const safeProject = projectName.replace(/"/g, "");
  return `aws resourcegroupstaggingapi tag-resources --region ${region} --resource-arn-list ${safeArns} --tags Project="${safeProject}"`;
}

export function buildTerraformDefaultTags(projectName: string): string {
  const safeProject = projectName.replace(/"/g, "");
  return `provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "${safeProject}"
      ManagedBy = "terraform"
    }
  }
}`;
}
