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

export function evaluateZombieRules(
  resources: PricedResourceSnapshot[],
  now: Date = new Date(),
): ComputedRuleFinding[] {
  const findings: ComputedRuleFinding[] = [];

  for (const r of resources) {
    // 1. Unattached Elastic IP
    if (r.service === "eip" && r.metadata.attached === false) {
      findings.push({
        resourceId: r.resourceId,
        resourceArn: r.arn,
        projectSlug: r.projectSlug,
        ruleCode: "UNATTACHED_EIP",
        severity: "high",
        title: `Unattached Elastic IP (${r.name})`,
        description: `Elastic IP ${r.name} (${r.resourceId}) is not associated with any running EC2 instance or network interface. Releasing it saves money immediately with zero impact on live apps.`,
        estimatedMonthlySavingsCents: r.monthlyCents,
        cliCommand: `aws ec2 release-address --region ${r.region} --allocation-id ${r.resourceId}`,
        terraformHint: `Remove unused aws_eip.${r.resourceId.replace(/[^a-z0-9_]/gi, "_")} or run terraform state rm if orphaned.`,
        keepsAppLive: true,
      });
    }

    // 2. Orphaned EBS Volume
    if (r.service === "ebs" && r.state.toLowerCase() === "available") {
      const sizeGb = typeof r.metadata.sizeGb === "number" ? r.metadata.sizeGb : 20;
      findings.push({
        resourceId: r.resourceId,
        resourceArn: r.arn,
        projectSlug: r.projectSlug,
        ruleCode: "ORPHANED_EBS",
        severity: "high",
        title: `Unattached ${sizeGb} GB EBS volume (${r.name})`,
        description: `EBS volume ${r.resourceId} is in "available" state and not attached to any EC2 instance. Snapshot it if needed, then delete the volume to stop monthly storage charges.`,
        estimatedMonthlySavingsCents: r.monthlyCents,
        cliCommand: `aws ec2 create-snapshot --region ${r.region} --volume-id ${r.resourceId} --description "Pre-cleanup backup" && aws ec2 delete-volume --region ${r.region} --volume-id ${r.resourceId}`,
        terraformHint: `Ensure ebs_block_device { delete_on_termination = true } on future EC2 launch templates.`,
        keepsAppLive: true,
      });
    }

    // 3. Stopped RDS 7-Day Auto-Restart Countdown
    if (r.service === "rds" && r.state.toLowerCase() === "stopped") {
      const stoppedAtRaw = r.metadata.stoppedAt;
      const stoppedAt =
        typeof stoppedAtRaw === "string" ? new Date(stoppedAtRaw) : null;
      const elapsedMs = stoppedAt && !Number.isNaN(stoppedAt.getTime())
        ? Math.max(0, now.getTime() - stoppedAt.getTime())
        : 5 * 24 * 60 * 60 * 1000;
      const remainingHours = Math.max(0, Math.round((SEVEN_DAYS_MS - elapsedMs) / 3_600_000));

      findings.push({
        resourceId: r.resourceId,
        resourceArn: r.arn,
        projectSlug: r.projectSlug,
        ruleCode: "RDS_7DAY_AUTORESTART",
        severity: remainingHours <= 48 ? "critical" : "high",
        title: `Stopped RDS auto-restarts in ~${remainingHours}h (${r.name})`,
        description: `AWS automatically restarts stopped RDS instances after 7 days and resumes hourly compute billing. Take a final snapshot and delete the idle instance, or downgrade its class before restart.`,
        estimatedMonthlySavingsCents: Math.max(r.monthlyCents, 4900),
        cliCommand: `aws rds delete-db-instance --region ${r.region} --db-instance-identifier ${r.resourceId} --final-db-snapshot-identifier ${r.resourceId}-final-snap`,
        terraformHint: `Use snapshot_identifier to restore on demand instead of keeping a stopped RDS instance idling.`,
        keepsAppLive: true,
      });
    }

    // 4. RDS Provisioned IOPS Downgrade to Baseline gp3
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
          title: `Over-provisioned RDS IOPS on ${r.name} (${iops.toLocaleString()} IOPS ${storageType})`,
          description: `Switching ${r.resourceId} storage from provisioned ${storageType} (${iops.toLocaleString()} IOPS) to baseline gp3 cuts storage IOPS fees online without taking the database offline.`,
          estimatedMonthlySavingsCents: iopsSavings,
          cliCommand: `aws rds modify-db-instance --region ${r.region} --db-instance-identifier ${r.resourceId} --storage-type gp3 --apply-immediately`,
          terraformHint: `Set storage_type = "gp3" and remove explicit iops > 3000 in aws_db_instance.${r.resourceId.replace(/[^a-z0-9_]/gi, "_")}.`,
          keepsAppLive: true,
        });
      }

      // 5. RDS Multi-AZ on non-production/demo DB
      const multiAzSavings = estimateRdsMultiAzSavingsCents(r);
      const envTag = (r.tags.Environment ?? r.tags.env ?? "").toLowerCase();
      const isLikelyNonProd =
        envTag !== "prod" && envTag !== "production";
      if (multiAzSavings > 0 && isLikelyNonProd) {
        findings.push({
          resourceId: r.resourceId,
          resourceArn: r.arn,
          projectSlug: r.projectSlug,
          ruleCode: "RDS_MULTIAZ_NONPROD",
          severity: "medium",
          title: `Multi-AZ active on non-prod RDS (${r.name})`,
          description: `${r.resourceId} runs Multi-AZ (2x compute and storage cost) without an Environment=production tag. Disabling Multi-AZ cuts database spend roughly in half while keeping the app live.`,
          estimatedMonthlySavingsCents: multiAzSavings,
          cliCommand: `aws rds modify-db-instance --region ${r.region} --db-instance-identifier ${r.resourceId} --no-multi-az --apply-immediately`,
          terraformHint: `Set multi_az = false for staging/portfolio/demo environments in aws_db_instance.`,
          keepsAppLive: true,
        });
      }
    }

    // 6. Secrets Manager -> SSM Parameter Store (Non-rotating secret)
    if (r.service === "secrets_manager" && r.metadata.rotationEnabled !== true) {
      findings.push({
        resourceId: r.resourceId,
        resourceArn: r.arn,
        projectSlug: r.projectSlug,
        ruleCode: "SECRETS_TO_SSM",
        severity: "low",
        title: `Non-rotating secret in Secrets Manager (${r.name})`,
        description: `Secret "${r.name}" has automatic rotation disabled ($0.40/mo). Moving static API keys and config values to AWS SSM Parameter Store (Standard SecureString) costs $0.00/mo forever.`,
        estimatedMonthlySavingsCents: r.monthlyCents,
        cliCommand: `aws ssm put-parameter --region ${r.region} --name "/${r.projectSlug === ORPHANED_PROJECT_SLUG ? "shared" : r.projectSlug}/${r.name.replace(/^\/+/, "")}" --type SecureString --value "<VALUE>" --overwrite`,
        terraformHint: `Replace aws_secretsmanager_secret with aws_ssm_parameter (type = "SecureString", tier = "Standard").`,
        keepsAppLive: true,
      });
    }

    // 7. NAT Gateway baseline cost alert
    if (r.service === "nat_gateway" && r.state.toLowerCase() === "available") {
      findings.push({
        resourceId: r.resourceId,
        resourceArn: r.arn,
        projectSlug: r.projectSlug,
        ruleCode: "IDLE_NAT_GATEWAY",
        severity: "medium",
        title: `Always-on NAT Gateway (${r.name})`,
        description: `NAT Gateway ${r.resourceId} burns ~$32.85/mo even with zero traffic. For portfolio/demo VPCs, switch public workloads to public subnets or use a $3/mo t4g.nano NAT instance / VPC Endpoints.`,
        estimatedMonthlySavingsCents: Math.max(0, r.monthlyCents - 300),
        cliCommand: `aws ec2 describe-route-tables --region ${r.region} --filters Name=route.nat-gateway-id,Values=${r.resourceId}`,
        terraformHint: `Replace aws_nat_gateway with S3/DynamoDB Gateway VPC Endpoints ($0/mo) or a t4g.nano fck-nat instance.`,
        keepsAppLive: true,
      });
    }

    // 8. Untagged / Orphaned Resource
    if (r.projectSlug === ORPHANED_PROJECT_SLUG) {
      findings.push({
        resourceId: r.resourceId,
        resourceArn: r.arn,
        projectSlug: r.projectSlug,
        ruleCode: "UNTAGGED_RESOURCE",
        severity: r.monthlyCents >= 1500 ? "high" : "medium",
        title: `Untagged resource (${r.name})`,
        description: `${r.name} (${r.service.toUpperCase()} in ${r.region}) has no Project tag and didn't match any prefix rule. Assign it to a project or verify if it's a leftover from a failed deploy.`,
        estimatedMonthlySavingsCents: 0,
        cliCommand: buildTagResourcesCli([r.arn], "my-project", r.region),
        terraformHint: `Add default_tags { tags = { Project = "my-project" } } to your Terraform AWS provider block.`,
        keepsAppLive: true,
      });
    }
  }

  return findings;
}
