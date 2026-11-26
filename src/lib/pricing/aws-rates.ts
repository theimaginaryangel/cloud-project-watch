import type { DiscoveredAwsResource } from "@/lib/domain/types";

export const HOURS_PER_MONTH = 730n;
export const MICROCENTS_PER_CENT = 1_000_000n;
export const MICROCENTS_PER_DOLLAR = 100_000_000n;

// Exact integer microcents per hour (1 USD = 100_000_000 microcents).
const EC2_HOURLY_MICROCENTS: Record<string, bigint> = {
  "t3.nano": 520_000n,
  "t3.micro": 1_040_000n,
  "t3.small": 2_080_000n,
  "t3.medium": 4_160_000n,
  "t3.large": 8_320_000n,
  "t3.xlarge": 16_640_000n,
  "t4g.nano": 420_000n,
  "t4g.micro": 840_000n,
  "t4g.small": 1_680_000n,
  "t4g.medium": 3_360_000n,
  "t4g.large": 6_720_000n,
  "m6i.large": 9_600_000n,
  "m6i.xlarge": 19_200_000n,
  "c6i.large": 8_500_000n,
  "c6i.xlarge": 17_000_000n,
};

const RDS_HOURLY_MICROCENTS: Record<string, bigint> = {
  "db.t3.micro": 1_700_000n,
  "db.t3.small": 3_400_000n,
  "db.t3.medium": 6_800_000n,
  "db.t3.large": 13_600_000n,
  "db.t4g.micro": 1_600_000n,
  "db.t4g.small": 3_200_000n,
  "db.t4g.medium": 6_400_000n,
  "db.m6i.large": 17_800_000n,
  "db.r6g.large": 24_000_000n,
};

const EBS_MONTHLY_CENTS_PER_GB: Record<string, bigint> = {
  gp3: 8n,
  gp2: 10n,
  io1: 13n,
  io2: 13n,
  st1: 5n,
  sc1: 2n,
};

const RDS_STORAGE_MONTHLY_CENTS_PER_GB: Record<string, bigint> = {
  gp3: 12n,
  gp2: 12n,
  io1: 13n,
  io2: 13n,
};

const EIP_HOURLY_MICROCENTS = 500_000n;
const NAT_GATEWAY_HOURLY_MICROCENTS = 4_500_000n;
const ELB_HOURLY_MICROCENTS = 2_250_000n;
const SECRET_MONTHLY_CENTS = 40n;
const PROVISIONED_IOPS_MONTHLY_CENTS_PER_IOPS = 10n;
const GP3_EXTRA_IOPS_MONTHLY_CENTS_PER_IOPS = 1n;

export function monthlyCentsFromHourlyMicrocents(hourlyMicrocents: bigint): number {
  if (hourlyMicrocents <= 0n) return 0;
  const totalMicrocents = hourlyMicrocents * HOURS_PER_MONTH;
  const roundedCents = (totalMicrocents + MICROCENTS_PER_CENT / 2n) / MICROCENTS_PER_CENT;
  return Number(roundedCents);
}

export function hourlyMicrocentsFromMonthlyCents(monthlyCents: bigint): number {
  if (monthlyCents <= 0n) return 0;
  const hourly = (monthlyCents * MICROCENTS_PER_CENT) / HOURS_PER_MONTH;
  return Number(hourly);
}

/**
 * Parses a USD decimal string (such as Cost Explorer's `"412.50"` or `"0.009"`)
 * into non-negative integer cents using exact integer math (no IEEE-754 floats).
 */
export function parseUsdDecimalToCents(amountStr: string): number {
  const trimmed = amountStr.trim();
  if (!trimmed || trimmed.startsWith("-")) return 0;

  const match = /^(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) return 0;

  const wholeDollars = BigInt(match[1] ?? "0");
  const fracRaw = (match[2] ?? "").padEnd(3, "0");
  const centsTwoDigits = BigInt(fracRaw.slice(0, 2));
  const thirdDigit = Number(fracRaw[2] ?? "0");

  const roundedCents =
    wholeDollars * 100n + centsTwoDigits + (thirdDigit >= 5 ? 1n : 0n);
  return Number(roundedCents);
}

function readNumberMeta(meta: Record<string, unknown>, key: string, fallback = 0): number {
  const value = meta[key];
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }
  return fallback;
}

function readStringMeta(meta: Record<string, unknown>, key: string, fallback = ""): string {
  const value = meta[key];
  return typeof value === "string" ? value : fallback;
}

function readBooleanMeta(meta: Record<string, unknown>, key: string): boolean {
  return meta[key] === true;
}

export interface EstimatedCost {
  hourlyMicrocents: number;
  monthlyCents: number;
}

export function estimateResourceCost(resource: DiscoveredAwsResource): EstimatedCost {
  const { service, state, metadata } = resource;
  const normalizedState = state.toLowerCase();

  switch (service) {
    case "ec2": {
      if (normalizedState !== "running") {
        return { hourlyMicrocents: 0, monthlyCents: 0 };
      }
      const instanceType = readStringMeta(metadata, "instanceType", "t3.micro");
      const hourly = EC2_HOURLY_MICROCENTS[instanceType] ?? 4_160_000n;
      return {
        hourlyMicrocents: Number(hourly),
        monthlyCents: monthlyCentsFromHourlyMicrocents(hourly),
      };
    }

    case "ebs": {
      if (normalizedState === "deleted" || normalizedState === "deleting") {
        return { hourlyMicrocents: 0, monthlyCents: 0 };
      }
      const sizeGb = BigInt(readNumberMeta(metadata, "sizeGb", 20));
      const volumeType = readStringMeta(metadata, "volumeType", "gp3");
      const ratePerGb = EBS_MONTHLY_CENTS_PER_GB[volumeType] ?? 8n;
      let monthlyCents = sizeGb * ratePerGb;

      const iops = readNumberMeta(metadata, "iops", 3000);
      if (volumeType === "io1" || volumeType === "io2") {
        monthlyCents += BigInt(iops) * 7n;
      } else if (volumeType === "gp3" && iops > 3000) {
        monthlyCents += BigInt(iops - 3000) * GP3_EXTRA_IOPS_MONTHLY_CENTS_PER_IOPS;
      }

      return {
        hourlyMicrocents: hourlyMicrocentsFromMonthlyCents(monthlyCents),
        monthlyCents: Number(monthlyCents),
      };
    }

    case "eip": {
      return {
        hourlyMicrocents: Number(EIP_HOURLY_MICROCENTS),
        monthlyCents: monthlyCentsFromHourlyMicrocents(EIP_HOURLY_MICROCENTS),
      };
    }

    case "nat_gateway": {
      if (normalizedState === "deleted" || normalizedState === "deleting") {
        return { hourlyMicrocents: 0, monthlyCents: 0 };
      }
      return {
        hourlyMicrocents: Number(NAT_GATEWAY_HOURLY_MICROCENTS),
        monthlyCents: monthlyCentsFromHourlyMicrocents(NAT_GATEWAY_HOURLY_MICROCENTS),
      };
    }

    case "rds": {
      if (normalizedState === "deleting" || normalizedState === "deleted") {
        return { hourlyMicrocents: 0, monthlyCents: 0 };
      }
      const instanceClass = readStringMeta(metadata, "dbInstanceClass", "db.t3.micro");
      const storageType = readStringMeta(metadata, "storageType", "gp3");
      const allocatedGb = BigInt(readNumberMeta(metadata, "allocatedStorageGb", 20));
      const iops = readNumberMeta(metadata, "iops", 0);
      const multiAz = readBooleanMeta(metadata, "multiAz");
      const azMultiplier = multiAz ? 2n : 1n;

      const storageRate = RDS_STORAGE_MONTHLY_CENTS_PER_GB[storageType] ?? 12n;
      let storageMonthlyCents = allocatedGb * storageRate * azMultiplier;

      if ((storageType === "io1" || storageType === "io2") && iops > 0) {
        storageMonthlyCents += BigInt(iops) * PROVISIONED_IOPS_MONTHLY_CENTS_PER_IOPS * azMultiplier;
      } else if (storageType === "gp3" && iops > 3000) {
        storageMonthlyCents += BigInt(iops - 3000) * GP3_EXTRA_IOPS_MONTHLY_CENTS_PER_IOPS * azMultiplier;
      }

      let computeHourly = 0n;
      if (normalizedState !== "stopped") {
        const baseHourly = RDS_HOURLY_MICROCENTS[instanceClass] ?? 6_800_000n;
        computeHourly = baseHourly * azMultiplier;
      }

      const computeMonthlyCents = BigInt(monthlyCentsFromHourlyMicrocents(computeHourly));
      const totalMonthlyCents = computeMonthlyCents + storageMonthlyCents;

      return {
        hourlyMicrocents: hourlyMicrocentsFromMonthlyCents(totalMonthlyCents),
        monthlyCents: Number(totalMonthlyCents),
      };
    }

    case "secrets_manager": {
      if (normalizedState === "deleted") {
        return { hourlyMicrocents: 0, monthlyCents: 0 };
      }
      return {
        hourlyMicrocents: hourlyMicrocentsFromMonthlyCents(SECRET_MONTHLY_CENTS),
        monthlyCents: Number(SECRET_MONTHLY_CENTS),
      };
    }

    case "elb": {
      if (normalizedState === "deleted") {
        return { hourlyMicrocents: 0, monthlyCents: 0 };
      }
      return {
        hourlyMicrocents: Number(ELB_HOURLY_MICROCENTS),
        monthlyCents: monthlyCentsFromHourlyMicrocents(ELB_HOURLY_MICROCENTS),
      };
    }
  }
}

export function estimateRdsRunningMonthlyCents(resource: DiscoveredAwsResource): number {
  return estimateResourceCost({ ...resource, state: "available" }).monthlyCents;
}

export function estimateRdsIopsDowngradeSavingsCents(resource: DiscoveredAwsResource): number {
  const storageType = readStringMeta(resource.metadata, "storageType", "gp3");
  const iops = readNumberMeta(resource.metadata, "iops", 0);
  const multiAz = readBooleanMeta(resource.metadata, "multiAz");
  const azMultiplier = multiAz ? 2n : 1n;

  if ((storageType === "io1" || storageType === "io2") && iops > 0) {
    return Number(BigInt(iops) * PROVISIONED_IOPS_MONTHLY_CENTS_PER_IOPS * azMultiplier);
  }
  if (storageType === "gp3" && iops > 3000) {
    return Number(BigInt(iops - 3000) * GP3_EXTRA_IOPS_MONTHLY_CENTS_PER_IOPS * azMultiplier);
  }
  return 0;
}

export function estimateRdsMultiAzSavingsCents(resource: DiscoveredAwsResource): number {
  if (!readBooleanMeta(resource.metadata, "multiAz")) return 0;
  const full = estimateResourceCost(resource).monthlyCents;
  const iopsSavings = estimateRdsIopsDowngradeSavingsCents(resource);
  return Math.max(0, Math.round((full - iopsSavings) / 2));
}
