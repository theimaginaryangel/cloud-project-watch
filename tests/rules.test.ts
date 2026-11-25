import { describe, expect, it } from "vitest";
import { getDemoAwsResources } from "@/lib/aws/demo-provider";
import { ORPHANED_PROJECT_SLUG, type DiscoveredAwsResource } from "@/lib/domain/types";
import { groupAndPriceResources } from "@/lib/grouping/project-grouper";
import { evaluateZombieRules } from "@/lib/rules/zombie-engine";

describe("Retroactive 4-layer project grouping & zombie rule engine", () => {
  it("enforces priority: arn_override > tag > prefix > parent > __orphaned__", () => {
    const resources: DiscoveredAwsResource[] = [
      {
        arn: "arn:aws:ec2:us-east-1:123:instance/i-tagged",
        resourceId: "i-tagged",
        service: "ec2",
        region: "us-east-1",
        name: "cloudpress-web",
        state: "running",
        tags: { Project: "CloudPress" },
        metadata: { instanceType: "t3.micro" },
      },
      {
        arn: "arn:aws:ec2:us-east-1:123:volume/vol-child",
        resourceId: "vol-child",
        service: "ebs",
        region: "us-east-1",
        name: "root-vol",
        state: "in-use",
        parentResourceId: "i-tagged",
        tags: {},
        metadata: { sizeGb: 20, volumeType: "gp3" },
      },
      {
        arn: "arn:aws:ec2:us-east-1:123:instance/i-prefix",
        resourceId: "i-prefix",
        service: "ec2",
        region: "us-east-1",
        name: "kaluna-worker",
        state: "running",
        tags: {},
        metadata: { instanceType: "t3.micro" },
      },
      {
        arn: "arn:aws:ec2:us-east-1:123:eip-allocation/eipalloc-orphan",
        resourceId: "eipalloc-orphan",
        service: "eip",
        region: "us-east-1",
        name: "3.229.118.41",
        state: "unassociated",
        tags: {},
        metadata: { attached: false },
      },
    ];

    const grouped = groupAndPriceResources(resources, [
      {
        ruleType: "arn_override",
        pattern: "arn:aws:ec2:us-east-1:123:instance/i-tagged",
        projectSlug: "override-app",
        projectLabel: "Override App",
        priority: 10,
      },
      {
        ruleType: "name_prefix",
        pattern: "kaluna-*",
        projectSlug: "kaluna",
        projectLabel: "Kaluna",
        priority: 100,
      },
    ]);

    const byId = new Map(grouped.map((r) => [r.resourceId, r]));
    expect(byId.get("i-tagged")?.projectSlug).toBe("override-app");
    expect(byId.get("i-tagged")?.projectSource).toBe("override");
    // Child EBS inherits parent EC2's resolved project!
    expect(byId.get("vol-child")?.projectSlug).toBe("override-app");
    expect(byId.get("vol-child")?.projectSource).toBe("parent");
    expect(byId.get("i-prefix")?.projectSlug).toBe("kaluna");
    expect(byId.get("i-prefix")?.projectSource).toBe("prefix");
    expect(byId.get("eipalloc-orphan")?.projectSlug).toBe(ORPHANED_PROJECT_SLUG);
    expect(byId.get("eipalloc-orphan")?.projectSource).toBe("orphaned");
  });

  it("detects all key zombie & surgical optimization rules on Demo Mode resources", () => {
    const fixedNow = new Date("2026-11-25T12:00:00Z");
    const demo = getDemoAwsResources(fixedNow);
    const priced = groupAndPriceResources(demo, []);
    const findings = evaluateZombieRules(priced, fixedNow);

    const codes = new Set(findings.map((f) => f.ruleCode));
    expect(codes.has("UNATTACHED_EIP")).toBe(true);
    expect(codes.has("ORPHANED_EBS")).toBe(true);
    expect(codes.has("RDS_7DAY_AUTORESTART")).toBe(true);
    expect(codes.has("SECRETS_TO_SSM")).toBe(true);
    expect(codes.has("RDS_PROVISIONED_IOPS")).toBe(true);
    expect(codes.has("RDS_MULTIAZ_NONPROD")).toBe(true);
    expect(codes.has("IDLE_NAT_GATEWAY")).toBe(true);
    expect(codes.has("UNTAGGED_RESOURCE")).toBe(true);

    // Verify RDS 7-day countdown reports ~48h remaining when stopped 5 days ago
    const restartFinding = findings.find((f) => f.ruleCode === "RDS_7DAY_AUTORESTART");
    expect(restartFinding?.severity).toBe("critical");
    expect(restartFinding?.title).toContain("~48h");

    // Verify CloudPress root EBS inherited CloudPress via parent EC2 (not orphaned!)
    const rootVol = priced.find((r) => r.resourceId === "vol-0cp0001");
    expect(rootVol?.projectSlug).toBe("cloudpress");
    expect(rootVol?.projectSource).toBe("parent");
  });
});
