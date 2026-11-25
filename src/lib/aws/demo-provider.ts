import {
  ORPHANED_PROJECT_LABEL,
  ORPHANED_PROJECT_SLUG,
  type AwsService,
  type CostRecommendationPlan,
  type DiscoveredAwsResource,
} from "@/lib/domain/types";
import { groupAndPriceResources } from "@/lib/grouping/project-grouper";
import { evaluateCostRules } from "@/lib/rules/cost-rules";
import type { DashboardPayload, ProjectSummaryDto } from "@/lib/scans/orchestrator";

export function getDemoAwsResources(now: Date = new Date()): DiscoveredAwsResource[] {
  const fiveDaysAgoIso = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();

  const cloudpressSecrets: DiscoveredAwsResource[] = Array.from({ length: 16 }, (_, idx) => {
    const num = String(idx + 1).padStart(2, "0");
    const secretName = `cloudpress/prod/config-${num}`;
    return {
      arn: `arn:aws:secretsmanager:us-east-1:123456789012:secret:${secretName}-AbCdEf`,
      resourceId: `${secretName}-AbCdEf`,
      service: "secrets_manager",
      region: "us-east-1",
      name: secretName,
      state: "active",
      tags: { Project: "CloudPress" },
      metadata: { rotationEnabled: false },
    };
  });

  return [
    // --- CloudPress (Live portfolio app burning way too much) ---
    {
      arn: "arn:aws:rds:us-east-1:123456789012:db:cloudpress-db",
      resourceId: "cloudpress-db",
      service: "rds",
      region: "us-east-1",
      name: "cloudpress-db",
      state: "available",
      tags: { Project: "CloudPress", Environment: "demo" },
      metadata: {
        dbInstanceClass: "db.t3.medium",
        engine: "postgres",
        storageType: "io1",
        allocatedStorageGb: 100,
        iops: 3000,
        multiAz: true,
      },
    },
    {
      arn: "arn:aws:ec2:us-east-1:123456789012:instance/i-0a1b2c3d4e5f00001",
      resourceId: "i-0a1b2c3d4e5f00001",
      service: "ec2",
      region: "us-east-1",
      name: "cloudpress-web-01",
      state: "running",
      tags: { Project: "CloudPress", Name: "cloudpress-web-01" },
      metadata: { instanceType: "t3.small", publicIp: "54.210.14.88" },
    },
    {
      arn: "arn:aws:ec2:us-east-1:123456789012:volume/vol-0cp0001",
      resourceId: "vol-0cp0001",
      service: "ebs",
      region: "us-east-1",
      name: "cloudpress-web-root",
      state: "in-use",
      parentResourceId: "i-0a1b2c3d4e5f00001",
      tags: {}, // Intentionally untagged to demonstrate parent-attachment inheritance!
      metadata: { sizeGb: 30, volumeType: "gp3", iops: 3000 },
    },
    {
      arn: "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/cloudpress-alb/1a2b3c4d",
      resourceId: "cloudpress-alb",
      service: "elb",
      region: "us-east-1",
      name: "cloudpress-alb",
      state: "active",
      tags: { Project: "CloudPress" },
      metadata: { type: "application", scheme: "internet-facing" },
    },
    ...cloudpressSecrets,

    // --- Kaluna (Serverless ticketing + forgotten staging DB & NAT) ---
    {
      arn: "arn:aws:rds:us-east-1:123456789012:db:kaluna-staging-db",
      resourceId: "kaluna-staging-db",
      service: "rds",
      region: "us-east-1",
      name: "kaluna-staging-db",
      state: "stopped",
      tags: { Project: "Kaluna", Environment: "staging" },
      metadata: {
        dbInstanceClass: "db.t3.medium",
        engine: "postgres",
        storageType: "gp3",
        allocatedStorageGb: 50,
        iops: 3000,
        multiAz: false,
        stoppedAt: fiveDaysAgoIso,
      },
    },
    {
      arn: "arn:aws:ec2:us-east-1:123456789012:natgateway/nat-0kaluna998877",
      resourceId: "nat-0kaluna998877",
      service: "nat_gateway",
      region: "us-east-1",
      name: "kaluna-private-nat",
      state: "available",
      tags: { Project: "Kaluna" },
      metadata: { subnetId: "subnet-0a1b2c3d", connectivityType: "public" },
    },

    // --- BankGuard (Matched via CloudFormation stack tag & name prefix) ---
    {
      arn: "arn:aws:ec2:us-east-2:123456789012:instance/i-0bankguard001",
      resourceId: "i-0bankguard001",
      service: "ec2",
      region: "us-east-2",
      name: "bankguard-worker",
      state: "running",
      tags: { "aws:cloudformation:stack-name": "BankGuard" },
      metadata: { instanceType: "t4g.small" },
    },
    {
      arn: "arn:aws:rds:us-east-2:123456789012:db:bankguard-ledger-db",
      resourceId: "bankguard-ledger-db",
      service: "rds",
      region: "us-east-2",
      name: "bankguard-ledger-db",
      state: "available",
      tags: { Project: "BankGuard", Environment: "demo" },
      metadata: {
        dbInstanceClass: "db.t4g.micro",
        engine: "postgres",
        storageType: "gp3",
        allocatedStorageGb: 20,
        iops: 3000,
        multiAz: false,
      },
    },

    // --- Untagged / Idle Resources (Leftovers from incomplete Terraform deploys) ---
    {
      arn: "arn:aws:ec2:us-east-1:123456789012:eip-allocation/eipalloc-0zmb0001",
      resourceId: "eipalloc-0zmb0001",
      service: "eip",
      region: "us-east-1",
      name: "3.229.118.41",
      state: "unassociated",
      tags: {},
      metadata: { publicIp: "3.229.118.41", attached: false },
    },
    {
      arn: "arn:aws:ec2:us-east-1:123456789012:eip-allocation/eipalloc-0zmb0002",
      resourceId: "eipalloc-0zmb0002",
      service: "eip",
      region: "us-east-1",
      name: "18.212.45.109",
      state: "unassociated",
      tags: {},
      metadata: { publicIp: "18.212.45.109", attached: false },
    },
    {
      arn: "arn:aws:ec2:us-east-1:123456789012:eip-allocation/eipalloc-0zmb0003",
      resourceId: "eipalloc-0zmb0003",
      service: "eip",
      region: "us-east-1",
      name: "52.90.12.203",
      state: "unassociated",
      tags: {},
      metadata: { publicIp: "52.90.12.203", attached: false },
    },
    {
      arn: "arn:aws:ec2:us-east-1:123456789012:eip-allocation/eipalloc-0zmb0004",
      resourceId: "eipalloc-0zmb0004",
      service: "eip",
      region: "us-east-1",
      name: "54.161.88.14",
      state: "unassociated",
      tags: {},
      metadata: { publicIp: "54.161.88.14", attached: false },
    },
    {
      arn: "arn:aws:ec2:us-east-1:123456789012:volume/vol-0orphan100gb",
      resourceId: "vol-0orphan100gb",
      service: "ebs",
      region: "us-east-1",
      name: "vol-0orphan100gb",
      state: "available",
      tags: {},
      metadata: { sizeGb: 100, volumeType: "gp2", iops: 300 },
    },
  ];
}

export function getDemoRecommendations(
  projectSlug: string,
): CostRecommendationPlan {
  if (projectSlug === "cloudpress") {
    return {
      summary:
        "Keep CloudPress live for visitors while cutting over 85% of monthly spend by downgrading RDS storage from provisioned io1 to baseline gp3, disabling Multi-AZ on the demo DB, and moving 16 static secrets to free SSM Parameter Store.",
      keepsAppLive: true,
      totalEstimatedMonthlySavingsCents: 66_040,
      actions: [
        {
          title: "Switch cloudpress-db storage from io1 (3,000 IOPS) to baseline gp3",
          targetResourceId: "cloudpress-db",
          estimatedMonthlySavingsCents: 60_000,
          riskLevel: "low",
          downtimeImpact: "zero_downtime",
          keepsAppLive: true,
          explanation:
            "Baseline gp3 includes 3,000 IOPS free without provisioned IOPS charges. AWS performs the storage modification online with zero downtime.",
          cliCommand:
            "aws rds modify-db-instance --region us-east-1 --db-instance-identifier cloudpress-db --storage-type gp3 --apply-immediately",
          terraformSnippet: `resource "aws_db_instance" "cloudpress" {\n  storage_type = "gp3"\n  # Remove iops = 3000 to stay on free baseline tier\n}`,
        },
        {
          title: "Disable Multi-AZ on demo database cloudpress-db",
          targetResourceId: "cloudpress-db",
          estimatedMonthlySavingsCents: 5_400,
          riskLevel: "low",
          downtimeImpact: "brief_restart",
          keepsAppLive: true,
          explanation:
            "Multi-AZ doubles both compute and storage billing for a portfolio demo. Single-AZ keeps automated daily backups intact at half the price.",
          cliCommand:
            "aws rds modify-db-instance --region us-east-1 --db-instance-identifier cloudpress-db --no-multi-az --apply-immediately",
          terraformSnippet: `resource "aws_db_instance" "cloudpress" {\n  multi_az = false\n}`,
        },
        {
          title: "Migrate 16 non-rotating secrets to SSM Parameter Store (Standard)",
          targetResourceId: "cloudpress/prod/config-01",
          estimatedMonthlySavingsCents: 640,
          riskLevel: "low",
          downtimeImpact: "zero_downtime",
          keepsAppLive: true,
          explanation:
            "Secrets Manager charges $0.40/secret/month even when automatic rotation is off. SSM Standard SecureString parameters are $0.00/month forever.",
          cliCommand:
            'aws ssm put-parameter --region us-east-1 --name "/cloudpress/prod/config-01" --type SecureString --value "<VALUE>" --overwrite',
          terraformSnippet: `resource "aws_ssm_parameter" "config" {\n  name  = "/cloudpress/prod/config-01"\n  type  = "SecureString"\n  tier  = "Standard"\n  value = var.config_value\n}`,
        },
      ],
    };
  }

  if (projectSlug === "kaluna") {
    return {
      summary:
        "Prevent Kaluna's stopped staging database from auto-restarting in 48 hours and eliminate the $32.85/mo NAT Gateway baseline charge without taking the public ticketing demo offline.",
      keepsAppLive: true,
      totalEstimatedMonthlySavingsCents: 7_885,
      actions: [
        {
          title: "Snapshot and delete stopped kaluna-staging-db before 7-day auto-restart",
          targetResourceId: "kaluna-staging-db",
          estimatedMonthlySavingsCents: 4_900,
          riskLevel: "low",
          downtimeImpact: "zero_downtime",
          keepsAppLive: true,
          explanation:
            "AWS automatically starts stopped RDS instances after 7 days and resumes full hourly compute charges. A final snapshot costs pennies and lets you restore anytime.",
          cliCommand:
            "aws rds delete-db-instance --region us-east-1 --db-instance-identifier kaluna-staging-db --final-db-snapshot-identifier kaluna-staging-final",
          terraformSnippet: `# Restore later with:\n# snapshot_identifier = "kaluna-staging-final"`,
        },
        {
          title: "Replace always-on NAT Gateway with VPC Gateway Endpoints or t4g.nano fck-nat",
          targetResourceId: "nat-0kaluna998877",
          estimatedMonthlySavingsCents: 2_985,
          riskLevel: "medium",
          downtimeImpact: "scheduled_window",
          keepsAppLive: true,
          explanation:
            "A managed NAT Gateway costs $32.85/mo idle. Moving serverless egress to public subnets or a $3/mo t4g.nano NAT instance saves ~$30/mo.",
          cliCommand:
            "aws ec2 describe-route-tables --region us-east-1 --filters Name=route.nat-gateway-id,Values=nat-0kaluna998877",
          terraformSnippet: `resource "aws_vpc_endpoint" "s3" {\n  vpc_id            = aws_vpc.kaluna.id\n  service_name      = "com.amazonaws.us-east-1.s3"\n  vpc_endpoint_type = "Gateway"\n}`,
        },
      ],
    };
  }

  return {
    summary:
      "Release unattached networking and storage resources left behind by incomplete deployments, and add Terraform default_tags so future resources are always tagged.",
    keepsAppLive: true,
    totalEstimatedMonthlySavingsCents: 2_460,
    actions: [
      {
        title: "Release unattached Elastic IPs immediately",
        targetResourceId: "eipalloc-0zmb0001",
        estimatedMonthlySavingsCents: 1_460,
        riskLevel: "low",
        downtimeImpact: "zero_downtime",
        keepsAppLive: true,
        explanation:
          "Four Elastic IPs are unassociated with any instance or ENI. Releasing them has zero impact on live apps and stops $14.60/mo in idle IPv4 billing.",
        cliCommand:
          "aws ec2 release-address --region us-east-1 --allocation-id eipalloc-0zmb0001",
        terraformSnippet: `# Remove unused aws_eip blocks or run:\n# terraform state rm aws_eip.unused`,
      },
      {
        title: "Snapshot and delete unattached 100 GB gp2 EBS volume",
        targetResourceId: "vol-0orphan100gb",
        estimatedMonthlySavingsCents: 1_000,
        riskLevel: "low",
        downtimeImpact: "zero_downtime",
        keepsAppLive: true,
        explanation:
          "This 100 GB EBS volume is in 'available' state (not mounted to any EC2 instance). Snapshot it for safety and delete the volume to save $10.00/mo.",
        cliCommand:
          'aws ec2 create-snapshot --region us-east-1 --volume-id vol-0orphan100gb --description "orphan-backup" && aws ec2 delete-volume --region us-east-1 --volume-id vol-0orphan100gb',
        terraformSnippet: `ebs_block_device {\n  delete_on_termination = true\n}`,
      },
    ],
  };
}

export function buildStatelessDemoDashboard(now: Date = new Date()): DashboardPayload {
  const discovered = getDemoAwsResources(now);
  const priced = groupAndPriceResources(discovered, []);
  const findings = evaluateCostRules(priced, now);

  const totalMonthlyCents = priced.reduce((sum, r) => sum + r.monthlyCents, 0);
  const potentialSavingsCents = findings.reduce(
    (sum, f) => sum + f.estimatedMonthlySavingsCents,
    0,
  );

  const bucketMap = new Map<
    string,
    {
      slug: string;
      label: string;
      resourceCount: number;
      monthlyCents: number;
      potentialSavingsCents: number;
      findingCount: number;
      criticalCount: number;
      services: Set<AwsService>;
    }
  >();

  for (const r of priced) {
    const existing = bucketMap.get(r.projectSlug) ?? {
      slug: r.projectSlug,
      label:
        r.projectSlug === ORPHANED_PROJECT_SLUG ? ORPHANED_PROJECT_LABEL : r.projectLabel,
      resourceCount: 0,
      monthlyCents: 0,
      potentialSavingsCents: 0,
      findingCount: 0,
      criticalCount: 0,
      services: new Set<AwsService>(),
    };
    existing.resourceCount += 1;
    existing.monthlyCents += r.monthlyCents;
    existing.services.add(r.service);
    bucketMap.set(r.projectSlug, existing);
  }

  for (const f of findings) {
    const existing = bucketMap.get(f.projectSlug);
    if (existing) {
      existing.findingCount += 1;
      existing.potentialSavingsCents += f.estimatedMonthlySavingsCents;
      if (f.severity === "critical") existing.criticalCount += 1;
    }
  }

  const projects: ProjectSummaryDto[] = [...bucketMap.values()]
    .map((b) => ({
      slug: b.slug,
      label: b.label,
      isOrphaned: b.slug === ORPHANED_PROJECT_SLUG,
      resourceCount: b.resourceCount,
      monthlyCents: b.monthlyCents,
      potentialSavingsCents: b.potentialSavingsCents,
      findingCount: b.findingCount,
      criticalCount: b.criticalCount,
      services: [...b.services],
    }))
    .sort((a, b) => {
      if (a.isOrphaned && !b.isOrphaned) return -1;
      if (!a.isOrphaned && b.isOrphaned) return 1;
      return b.monthlyCents - a.monthlyCents;
    });

  const mappedFindings = findings.map((f, idx) => ({
    id: `demo-finding-${idx}`,
    resourceId: f.resourceId,
    resourceArn: f.resourceArn,
    projectSlug: f.projectSlug,
    ruleCode: f.ruleCode,
    severity: f.severity,
    title: f.title,
    description: f.description,
    estimatedMonthlySavingsCents: f.estimatedMonthlySavingsCents,
    cliCommand: f.cliCommand,
    terraformHint: f.terraformHint,
    keepsAppLive: f.keepsAppLive,
  }));

  const urgentAlerts = mappedFindings
    .filter(
      (f) =>
        f.severity === "critical" ||
        f.ruleCode === "RDS_7DAY_AUTORESTART" ||
        f.ruleCode === "UNATTACHED_EIP" ||
        f.ruleCode === "ORPHANED_EBS",
    )
    .sort((a, b) => b.estimatedMonthlySavingsCents - a.estimatedMonthlySavingsCents)
    .slice(0, 6)
    .map((f) => ({
      id: f.id,
      projectSlug: f.projectSlug,
      resourceId: f.resourceId,
      ruleCode: f.ruleCode,
      severity: f.severity,
      title: f.title,
      description: f.description,
      estimatedMonthlySavingsCents: f.estimatedMonthlySavingsCents,
      cliCommand: f.cliCommand,
    }));

  const isoNow = now.toISOString();

  return {
    connection: {
      id: "stateless-demo",
      name: "Demo AWS",
      mode: "demo",
      regions: ["us-east-1", "us-east-2"],
      costExplorerEnabled: false,
    },
    latestScan: {
      id: "stateless-demo-scan",
      status: "completed",
      resourceCount: priced.length,
      totalMonthlyCents,
      potentialSavingsCents,
      completedAt: isoNow,
      startedAt: isoNow,
    },
    projects,
    urgentAlerts,
    findings: mappedFindings,
    resources: priced.map((r, idx) => ({
      id: `demo-res-${idx}`,
      arn: r.arn,
      resourceId: r.resourceId,
      service: r.service,
      region: r.region,
      name: r.name,
      state: r.state,
      projectSlug: r.projectSlug,
      projectLabel: r.projectLabel,
      projectSource: r.projectSource,
      hourlyMicrocents: r.hourlyMicrocents,
      monthlyCents: r.monthlyCents,
      tags: r.tags,
      metadata: r.metadata,
    })),
    costExplorer: null,
    aiStatus: {
      geminiConfigured: false,
      groqConfigured: false,
      defaultProvider: "auto",
    },
  };
}
