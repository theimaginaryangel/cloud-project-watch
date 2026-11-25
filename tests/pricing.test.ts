import { describe, expect, it } from "vitest";
import type { DiscoveredAwsResource } from "@/lib/domain/types";
import {
  estimateRdsIopsDowngradeSavingsCents,
  estimateRdsMultiAzSavingsCents,
  estimateResourceCost,
  monthlyCentsFromHourlyMicrocents,
} from "@/lib/pricing/aws-rates";

describe("AWS integer-microcent pricing engine", () => {
  it("converts exact hourly microcents to monthly cents without float drift", () => {
    // $0.005/hr * 730h = $3.65 (365 cents)
    expect(monthlyCentsFromHourlyMicrocents(500_000n)).toBe(365);
    // $0.045/hr * 730h = $32.85 (3285 cents)
    expect(monthlyCentsFromHourlyMicrocents(4_500_000n)).toBe(3285);
    expect(monthlyCentsFromHourlyMicrocents(0n)).toBe(0);
    expect(monthlyCentsFromHourlyMicrocents(-100n)).toBe(0);
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
    // Compute: $0.068 * 2 * 730 = $99.28 (9928c)
    // Storage: 100GB * $0.13 * 2 = $26.00 (2600c)
    // IOPS: 3000 * $0.10 * 2 = $600.00 (60000c)
    expect(cost.monthlyCents).toBe(72528);
    expect(estimateRdsIopsDowngradeSavingsCents(rds)).toBe(60000);
    // Multi-AZ savings excludes already-counted IOPS savings: (72528 - 60000) / 2 = 6264
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
