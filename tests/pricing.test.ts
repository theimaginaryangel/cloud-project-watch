import { describe, expect, it } from "vitest";
import type { DiscoveredAwsResource } from "@/lib/domain/types";
import {
  estimateRdsIopsDowngradeSavingsCents,
  estimateRdsMultiAzSavingsCents,
  estimateResourceCost,
  monthlyCentsFromHourlyMicrocents,
  parseUsdDecimalToCents,
} from "@/lib/pricing/aws-rates";

describe("AWS integer-microcent pricing engine", () => {
  it("converts exact hourly microcents to monthly cents without float drift", () => {
    expect(monthlyCentsFromHourlyMicrocents(500_000n)).toBe(365);
    expect(monthlyCentsFromHourlyMicrocents(4_500_000n)).toBe(3285);
    expect(monthlyCentsFromHourlyMicrocents(0n)).toBe(0);
    expect(monthlyCentsFromHourlyMicrocents(-100n)).toBe(0);
  });

  it("parses Cost Explorer USD decimal strings to exact integer cents without float drift", () => {
    expect(parseUsdDecimalToCents("0")).toBe(0);
    expect(parseUsdDecimalToCents("19.99")).toBe(1999);
    expect(parseUsdDecimalToCents("412.5")).toBe(41250);
    expect(parseUsdDecimalToCents("0.005")).toBe(1);
    expect(parseUsdDecimalToCents("0.004")).toBe(0);
    expect(parseUsdDecimalToCents("-12.34")).toBe(0);
    expect(parseUsdDecimalToCents("not-a-number")).toBe(0);
  });

  it("prices running vs stopped EC2 accurately", () => {
    const running: DiscoveredAwsResource = {
      arn: "arn:aws:ec2:us-east-1:123:instance/i-1",
      resourceId: "i-1",
      service: "ec2",
      region: "us-east-1",
      name: "web",
      state: "running",
      tags: {},
      metadata: { instanceType: "t3.small" },
    };
    const stopped: DiscoveredAwsResource = { ...running, state: "stopped" };

    expect(estimateResourceCost(running).monthlyCents).toBe(1518);
    expect(estimateResourceCost(stopped).monthlyCents).toBe(0);
  });

  it("prices RDS provisioned io1 IOPS and Multi-AZ multiplier and computes downgrade savings", () => {
    const rds: DiscoveredAwsResource = {
      arn: "arn:aws:rds:us-east-1:123:db:cloudpress-db",
      resourceId: "cloudpress-db",
      service: "rds",
      region: "us-east-1",
      name: "cloudpress-db",
      state: "available",
      tags: { Project: "CloudPress" },
      metadata: {
        dbInstanceClass: "db.t3.medium",
        storageType: "io1",
        allocatedStorageGb: 100,
        iops: 3000,
        multiAz: true,
      },
    };

    const cost = estimateResourceCost(rds);
    expect(cost.monthlyCents).toBe(72528);
    expect(estimateRdsIopsDowngradeSavingsCents(rds)).toBe(60000);
    expect(estimateRdsMultiAzSavingsCents(rds)).toBe(6264);
  });

  it("prices Secrets Manager at $0.40/secret/mo and unattached EIP at $3.65/mo", () => {
    const secret: DiscoveredAwsResource = {
      arn: "arn:aws:secretsmanager:us-east-1:123:secret:foo",
      resourceId: "foo",
      service: "secrets_manager",
      region: "us-east-1",
      name: "foo",
      state: "active",
      tags: {},
      metadata: { rotationEnabled: false },
    };
    const eip: DiscoveredAwsResource = {
      arn: "arn:aws:ec2:us-east-1:123:eip-allocation/eipalloc-1",
      resourceId: "eipalloc-1",
      service: "eip",
      region: "us-east-1",
      name: "1.2.3.4",
      state: "unassociated",
      tags: {},
      metadata: { attached: false },
    };

    expect(estimateResourceCost(secret).monthlyCents).toBe(40);
    expect(estimateResourceCost(eip).monthlyCents).toBe(365);
  });
});
