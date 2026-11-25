import {
  ORPHANED_PROJECT_SLUG,
  type ComputedRuleFinding,
  type PricedResourceSnapshot,
} from "@/lib/domain/types";
import { buildTagResourcesCli } from "@/lib/grouping/project-grouper";
import {
  estimateRdsIopsDowngradeSavingsCents,
  estimateRdsMultiAzSavingsCents,
} from "@/lib/pricing/aws-rates";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function evaluateCostRules(
  resources: PricedResourceSnapshot[],
  now: Date = new Date(),
): ComputedRuleFinding[] {
  const findings: ComputedRuleFinding[] = [];

  for (const r of resources) {
    if (r.service === "eip" && r.metadata.attached === false) {
      findings.push({
        resourceId: r.resourceId,
        resourceArn: r.arn,
        projectSlug: r.projectSlug,
        ruleCode: "UNATTACHED_EIP",
        severity: "high",
        title: `Unattached Elastic IP (${r.name})`,
        description: `${r.resourceId} is not attached to any instance. Releasing it stops hourly IPv4 charges without affecting running services.`,
        estimatedMonthlySavingsCents: r.monthlyCents,
        cliCommand: `aws ec2 release-address --region ${r.region} --allocation-id ${r.resourceId}`,
        terraformHint: `Remove the unused aws_eip block or run terraform state rm if it is no longer tracked.`,
        keepsAppLive: true,
      });
    }

    if (r.service === "ebs" && r.state.toLowerCase() === "available") {
      const sizeGb = typeof r.metadata.sizeGb === "number" ? r.metadata.sizeGb : 20;
      findings.push({
        resourceId: r.resourceId,
        resourceArn: r.arn,
        projectSlug: r.projectSlug,
        ruleCode: "ORPHANED_EBS",
        severity: "high",
        title: `Unattached ${sizeGb} GB EBS volume (${r.name})`,
        description: `${r.resourceId} is not mounted to any EC2 instance. Take a snapshot if you need the data, then delete the volume.`,
        estimatedMonthlySavingsCents: r.monthlyCents,
        cliCommand: `aws ec2 create-snapshot --region ${r.region} --volume-id ${r.resourceId} --description "Pre-cleanup backup" && aws ec2 delete-volume --region ${r.region} --volume-id ${r.resourceId}`,
        terraformHint: `Set delete_on_termination = true inside ebs_block_device for future instances.`,
        keepsAppLive: true,
      });
    }

    if (r.service === "rds" && r.state.toLowerCase() === "stopped") {
      const stoppedAtRaw = r.metadata.stoppedAt;
      const stoppedAt =
        typeof stoppedAtRaw === "string" ? new Date(stoppedAtRaw) : null;
      const elapsedMs =
        stoppedAt && !Number.isNaN(stoppedAt.getTime())
          ? Math.max(0, now.getTime() - stoppedAt.getTime())
          : 5 * 24 * 60 * 60 * 1000;
      const remainingHours = Math.max(0, Math.round((SEVEN_DAYS_MS - elapsedMs) / 3_600_000));

      findings.push({
        resourceId: r.resourceId,
        resourceArn: r.arn,
        projectSlug: r.projectSlug,
        ruleCode: "RDS_7DAY_AUTORESTART",
        severity: remainingHours <= 48 ? "critical" : "high",
        title: `Stopped RDS restarts in ~${remainingHours}h (${r.name})`,
        description: `AWS starts stopped RDS instances automatically after 7 days and resumes hourly compute billing. Create a final snapshot and delete it if you do not need it running.`,
        estimatedMonthlySavingsCents: Math.max(r.monthlyCents, 4900),
        cliCommand: `aws rds delete-db-instance --region ${r.region} --db-instance-identifier ${r.resourceId} --final-db-snapshot-identifier ${r.resourceId}-final-snap`,
        terraformHint: `Restore from snapshot_identifier when needed instead of keeping a stopped database idling.`,
        keepsAppLive: true,
      });
    }

    if (r.service === "rds") {
      const iopsSavings = estimateRdsIopsDowngradeSavingsCents(r);
      if (iopsSavings > 0) {
        const storageType = String(r.metadata.storageType ?? "io1");
        const iops = typeof r.metadata.iops === "number" ? r.metadata.iops : 3000;
        findings.push({
          resourceId: r.resourceId,
          resourceArn: r.arn,
          projectSlug: r.projectSlug,
          ruleCode: "RDS_PROVISIONED_IOPS",
          severity: "critical",
          title: `Provisioned IOPS on ${r.name} (${iops.toLocaleString()} IOPS ${storageType})`,
          description: `Baseline gp3 includes 3,000 IOPS at no extra cost. AWS applies the change online without taking the database down.`,
          estimatedMonthlySavingsCents: iopsSavings,
          cliCommand: `aws rds modify-db-instance --region ${r.region} --db-instance-identifier ${r.resourceId} --storage-type gp3 --apply-immediately`,
          terraformHint: `Set storage_type = "gp3" and remove custom iops settings in aws_db_instance.`,
          keepsAppLive: true,
        });
      }

      const multiAzSavings = estimateRdsMultiAzSavingsCents(r);
      const envTag = (r.tags.Environment ?? r.tags.env ?? "").toLowerCase();
      const isLikelyNonProd = envTag !== "prod" && envTag !== "production";
      if (multiAzSavings > 0 && isLikelyNonProd) {
        findings.push({
          resourceId: r.resourceId,
          resourceArn: r.arn,
          projectSlug: r.projectSlug,
          ruleCode: "RDS_MULTIAZ_NONPROD",
          severity: "medium",
          title: `Multi-AZ enabled on non-prod RDS (${r.name})`,
          description: `${r.resourceId} runs a standby replica at 2x compute and storage cost without an Environment=production tag. Turning off Multi-AZ cuts database cost in half.`,
          estimatedMonthlySavingsCents: multiAzSavings,
          cliCommand: `aws rds modify-db-instance --region ${r.region} --db-instance-identifier ${r.resourceId} --no-multi-az --apply-immediately`,
          terraformHint: `Set multi_az = false for staging or demo databases in aws_db_instance.`,
          keepsAppLive: true,
        });
      }
    }

    if (r.service === "secrets_manager" && r.metadata.rotationEnabled !== true) {
      findings.push({
        resourceId: r.resourceId,
        resourceArn: r.arn,
        projectSlug: r.projectSlug,
        ruleCode: "SECRETS_TO_SSM",
        severity: "low",
        title: `Static secret in Secrets Manager (${r.name})`,
        description: `Automatic rotation is off ($0.40/month). Storing non-rotating keys in SSM Parameter Store (Standard SecureString) is free.`,
        estimatedMonthlySavingsCents: r.monthlyCents,
        cliCommand: `aws ssm put-parameter --region ${r.region} --name "/${r.projectSlug === ORPHANED_PROJECT_SLUG ? "shared" : r.projectSlug}/${r.name.replace(/^\/+/, "")}" --type SecureString --value "<VALUE>" --overwrite`,
        terraformHint: `Replace aws_secretsmanager_secret with aws_ssm_parameter (type = "SecureString", tier = "Standard").`,
        keepsAppLive: true,
      });
    }

    if (r.service === "nat_gateway" && r.state.toLowerCase() === "available") {
      findings.push({
        resourceId: r.resourceId,
        resourceArn: r.arn,
        projectSlug: r.projectSlug,
        ruleCode: "IDLE_NAT_GATEWAY",
        severity: "medium",
        title: `Running NAT Gateway (${r.name})`,
        description: `NAT Gateway ${r.resourceId} costs about $32.85/month even when idle. Consider VPC Gateway Endpoints or a small t4g.nano NAT instance for dev/demo traffic.`,
        estimatedMonthlySavingsCents: Math.max(0, r.monthlyCents - 300),
        cliCommand: `aws ec2 describe-route-tables --region ${r.region} --filters Name=route.nat-gateway-id,Values=${r.resourceId}`,
        terraformHint: `Replace aws_nat_gateway with S3/DynamoDB Gateway VPC Endpoints or a t4g.nano NAT instance.`,
        keepsAppLive: true,
      });
    }

    if (r.projectSlug === ORPHANED_PROJECT_SLUG) {
      findings.push({
        resourceId: r.resourceId,
        resourceArn: r.arn,
        projectSlug: r.projectSlug,
        ruleCode: "UNTAGGED_RESOURCE",
        severity: r.monthlyCents >= 1500 ? "high" : "medium",
        title: `Untagged resource (${r.name})`,
        description: `${r.name} (${r.service.toUpperCase()} in ${r.region}) has no Project tag and matched no prefix rule. Assign it to a project or check if it was left behind by a failed deploy.`,
        estimatedMonthlySavingsCents: 0,
        cliCommand: buildTagResourcesCli([r.arn], "my-project", r.region),
        terraformHint: `Add default_tags { tags = { Project = "my-project" } } to your AWS provider block.`,
        keepsAppLive: true,
      });
    }
  }

  return findings;
}
