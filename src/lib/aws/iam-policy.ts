export const READONLY_IAM_POLICY = {
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "CloudProjectWatchFreeDiscovery",
      Effect: "Allow",
      Action: [
        "tag:GetResources",
        "ec2:DescribeInstances",
        "ec2:DescribeAddresses",
        "ec2:DescribeVolumes",
        "ec2:DescribeNatGateways",
        "ec2:DescribeRegions",
        "rds:DescribeDBInstances",
        "secretsmanager:ListSecrets",
        "elasticloadbalancing:DescribeLoadBalancers",
        "sts:GetCallerIdentity",
      ],
      Resource: "*",
    },
  ],
} as const;

export const OPTIONAL_COST_EXPLORER_STATEMENT = {
  Sid: "CloudProjectWatchDailyCostExplorer",
  Effect: "Allow",
  Action: ["ce:GetCostAndUsage"],
  Resource: "*",
} as const;

export function getReadOnlyPolicyJson(includeCostExplorer = false): string {
  const statements = includeCostExplorer
    ? [...READONLY_IAM_POLICY.Statement, OPTIONAL_COST_EXPLORER_STATEMENT]
    : [...READONLY_IAM_POLICY.Statement];

  return JSON.stringify(
    {
      Version: READONLY_IAM_POLICY.Version,
      Statement: statements,
    },
    null,
    2,
  );
}
