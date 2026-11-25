import {
  DescribeAddressesCommand,
  DescribeInstancesCommand,
  DescribeNatGatewaysCommand,
  DescribeVolumesCommand,
  EC2Client,
} from "@aws-sdk/client-ec2";
import {
  DescribeLoadBalancersCommand,
  DescribeTagsCommand as DescribeElbTagsCommand,
  ElasticLoadBalancingV2Client,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import { DescribeDBInstancesCommand, RDSClient } from "@aws-sdk/client-rds";
import {
  GetResourcesCommand,
  ResourceGroupsTaggingAPIClient,
} from "@aws-sdk/client-resource-groups-tagging-api";
import { ListSecretsCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import type { DiscoveredAwsResource } from "@/lib/domain/types";

export interface AwsClientCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

const REQUEST_TIMEOUT_MS = 15_000;

function toTagRecord(
  tags: Array<{ Key?: string; Value?: string }> | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!tags) return result;
  for (const tag of tags) {
    if (tag.Key && tag.Value !== undefined) {
      result[tag.Key] = tag.Value;
    }
  }
  return result;
}

function clientConfig(region: string, credentials?: AwsClientCredentials) {
  return {
    region,
    ...(credentials ? { credentials } : {}),
  };
}

export async function testAwsCredentials(
  region: string,
  credentials?: AwsClientCredentials,
): Promise<{ accountId: string; arn: string }> {
  const sts = new STSClient(clientConfig(region, credentials));
  const res = await sts.send(new GetCallerIdentityCommand({}), {
    abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return {
    accountId: res.Account ?? "unknown",
    arn: res.Arn ?? "unknown",
  };
}

async function fetchTagMapForRegion(
  region: string,
  credentials?: AwsClientCredentials,
): Promise<Map<string, Record<string, string>>> {
  const tagMap = new Map<string, Record<string, string>>();
  const client = new ResourceGroupsTaggingAPIClient(clientConfig(region, credentials));

  let paginationToken: string | undefined;
  let pages = 0;

  while (pages < 10) {
    pages += 1;
    const res = await client.send(
      new GetResourcesCommand({
        PaginationToken: paginationToken,
        ResourcesPerPage: 100,
      }),
      { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    );

    for (const mapping of res.ResourceTagMappingList ?? []) {
      if (mapping.ResourceARN) {
        tagMap.set(mapping.ResourceARN, toTagRecord(mapping.Tags));
      }
    }

    if (!res.PaginationToken) break;
    paginationToken = res.PaginationToken;
  }

  return tagMap;
}

async function scanRegion(
  region: string,
  accountId: string,
  credentials?: AwsClientCredentials,
): Promise<{ resources: DiscoveredAwsResource[]; warnings: string[] }> {
  const cfg = clientConfig(region, credentials);
  const ec2 = new EC2Client(cfg);
  const rds = new RDSClient(cfg);
  const secrets = new SecretsManagerClient(cfg);
  const elb = new ElasticLoadBalancingV2Client(cfg);

  const signal = () => AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  const [
    tagMapResult,
    instancesResult,
    addressesResult,
    volumesResult,
    natsResult,
    rdsResult,
    secretsResult,
    elbsResult,
  ] = await Promise.allSettled([
    fetchTagMapForRegion(region, credentials),
    ec2.send(new DescribeInstancesCommand({ MaxResults: 200 }), { abortSignal: signal() }),
    ec2.send(new DescribeAddressesCommand({}), { abortSignal: signal() }),
    ec2.send(new DescribeVolumesCommand({ MaxResults: 200 }), { abortSignal: signal() }),
    ec2.send(new DescribeNatGatewaysCommand({ MaxResults: 100 }), { abortSignal: signal() }),
    rds.send(new DescribeDBInstancesCommand({ MaxRecords: 100 }), { abortSignal: signal() }),
    secrets.send(new ListSecretsCommand({ MaxResults: 100 }), { abortSignal: signal() }),
    elb.send(new DescribeLoadBalancersCommand({ PageSize: 100 }), { abortSignal: signal() }),
  ]);

  const warnings: string[] = [];
  const resources: DiscoveredAwsResource[] = [];
  const tagMap =
    tagMapResult.status === "fulfilled"
      ? tagMapResult.value
      : new Map<string, Record<string, string>>();

  if (tagMapResult.status === "rejected") {
    warnings.push(`[${region}] Tagging API skipped: ${String(tagMapResult.reason)}`);
  }

  // 1. EC2 Instances
  if (instancesResult.status === "fulfilled") {
    for (const reservation of instancesResult.value.Reservations ?? []) {
      for (const inst of reservation.Instances ?? []) {
        const state = inst.State?.Name ?? "unknown";
        if (state === "terminated") continue;
        const id = inst.InstanceId ?? "unknown";
        const arn = `arn:aws:ec2:${region}:${accountId}:instance/${id}`;
        const tags = { ...tagMap.get(arn), ...toTagRecord(inst.Tags) };
        resources.push({
          arn,
          resourceId: id,
          service: "ec2",
          region,
          name: tags.Name || id,
          state,
          tags,
          metadata: {
            instanceType: inst.InstanceType ?? "t3.micro",
            publicIp: inst.PublicIpAddress ?? null,
          },
        });
      }
    }
  } else {
    warnings.push(`[${region}] EC2 instances error: ${String(instancesResult.reason)}`);
  }

  // 2. Elastic IPs
  if (addressesResult.status === "fulfilled") {
    for (const addr of addressesResult.value.Addresses ?? []) {
      const id = addr.AllocationId ?? addr.PublicIp ?? "unknown";
      const arn = `arn:aws:ec2:${region}:${accountId}:eip-allocation/${id}`;
      const tags = { ...tagMap.get(arn), ...toTagRecord(addr.Tags) };
      const attached = Boolean(addr.AssociationId || addr.InstanceId || addr.NetworkInterfaceId);
      resources.push({
        arn,
        resourceId: id,
        service: "eip",
        region,
        name: tags.Name || addr.PublicIp || id,
        state: attached ? "associated" : "unassociated",
        parentResourceId: addr.InstanceId,
        tags,
        metadata: {
          publicIp: addr.PublicIp ?? null,
          attached,
        },
      });
    }
  } else {
    warnings.push(`[${region}] Elastic IPs error: ${String(addressesResult.reason)}`);
  }

  // 3. EBS Volumes
  if (volumesResult.status === "fulfilled") {
    for (const vol of volumesResult.value.Volumes ?? []) {
      const id = vol.VolumeId ?? "unknown";
      const arn = `arn:aws:ec2:${region}:${accountId}:volume/${id}`;
      const tags = { ...tagMap.get(arn), ...toTagRecord(vol.Tags) };
      const attachedInstanceId = vol.Attachments?.[0]?.InstanceId;
      resources.push({
        arn,
        resourceId: id,
        service: "ebs",
        region,
        name: tags.Name || id,
        state: vol.State ?? "unknown",
        parentResourceId: attachedInstanceId,
        tags,
        metadata: {
          sizeGb: vol.Size ?? 0,
          volumeType: vol.VolumeType ?? "gp3",
          iops: vol.Iops ?? 3000,
        },
      });
    }
  } else {
    warnings.push(`[${region}] EBS volumes error: ${String(volumesResult.reason)}`);
  }

  // 4. NAT Gateways
  if (natsResult.status === "fulfilled") {
    for (const nat of natsResult.value.NatGateways ?? []) {
      if (nat.State === "deleted") continue;
      const id = nat.NatGatewayId ?? "unknown";
      const arn = `arn:aws:ec2:${region}:${accountId}:natgateway/${id}`;
      const tags = { ...tagMap.get(arn), ...toTagRecord(nat.Tags) };
      resources.push({
        arn,
        resourceId: id,
        service: "nat_gateway",
        region,
        name: tags.Name || id,
        state: nat.State ?? "unknown",
        tags,
        metadata: {
          subnetId: nat.SubnetId ?? null,
          connectivityType: nat.ConnectivityType ?? "public",
        },
      });
    }
  } else {
    warnings.push(`[${region}] NAT gateways error: ${String(natsResult.reason)}`);
  }

  // 5. RDS DB Instances
  if (rdsResult.status === "fulfilled") {
    for (const db of rdsResult.value.DBInstances ?? []) {
      const id = db.DBInstanceIdentifier ?? "unknown";
      const arn = db.DBInstanceArn ?? `arn:aws:rds:${region}:${accountId}:db:${id}`;
      const tags = { ...tagMap.get(arn), ...toTagRecord(db.TagList) };
      resources.push({
        arn,
        resourceId: id,
        service: "rds",
        region,
        name: id,
        state: db.DBInstanceStatus ?? "unknown",
        tags,
        metadata: {
          dbInstanceClass: db.DBInstanceClass ?? "db.t3.micro",
          engine: db.Engine ?? "postgres",
          storageType: db.StorageType ?? "gp3",
          allocatedStorageGb: db.AllocatedStorage ?? 20,
          iops: db.Iops ?? 0,
          multiAz: Boolean(db.MultiAZ),
          stoppedAt: db.AutomaticRestartTime
            ? new Date(db.AutomaticRestartTime.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
            : null,
        },
      });
    }
  } else {
    warnings.push(`[${region}] RDS error: ${String(rdsResult.reason)}`);
  }

  // 6. Secrets Manager
  if (secretsResult.status === "fulfilled") {
    for (const secret of secretsResult.value.SecretList ?? []) {
      if (secret.DeletedDate) continue;
      const arn = secret.ARN ?? `arn:aws:secretsmanager:${region}:${accountId}:secret:${secret.Name}`;
      const name = secret.Name ?? arn;
      const tags = { ...tagMap.get(arn), ...toTagRecord(secret.Tags) };
      resources.push({
        arn,
        resourceId: name,
        service: "secrets_manager",
        region,
        name,
        state: "active",
        tags,
        metadata: {
          rotationEnabled: Boolean(secret.RotationEnabled),
        },
      });
    }
  } else {
    warnings.push(`[${region}] Secrets Manager error: ${String(secretsResult.reason)}`);
  }

  // 7. ELBv2 Load Balancers
  if (elbsResult.status === "fulfilled") {
    const lbs = elbsResult.value.LoadBalancers ?? [];
    const lbArns = lbs.map((lb) => lb.LoadBalancerArn).filter((a): a is string => Boolean(a));
    const elbTagMap = new Map<string, Record<string, string>>();

    if (lbArns.length > 0) {
      try {
        const tagRes = await elb.send(
          new DescribeElbTagsCommand({ ResourceArns: lbArns.slice(0, 20) }),
          { abortSignal: signal() },
        );
        for (const desc of tagRes.TagDescriptions ?? []) {
          if (desc.ResourceArn) {
            elbTagMap.set(desc.ResourceArn, toTagRecord(desc.Tags));
          }
        }
      } catch {
        // Non-fatal: fallback to ResourceGroupsTaggingAPI map
      }
    }

    for (const lb of lbs) {
      const arn = lb.LoadBalancerArn ?? "";
      const name = lb.LoadBalancerName ?? arn;
      const tags = { ...tagMap.get(arn), ...elbTagMap.get(arn) };
      resources.push({
        arn: arn || `arn:aws:elasticloadbalancing:${region}:${accountId}:loadbalancer/${name}`,
        resourceId: name,
        service: "elb",
        region,
        name,
        state: lb.State?.Code ?? "active",
        tags,
        metadata: {
          type: lb.Type ?? "application",
          scheme: lb.Scheme ?? "internet-facing",
        },
      });
    }
  } else {
    warnings.push(`[${region}] ELB error: ${String(elbsResult.reason)}`);
  }

  return { resources, warnings };
}

export async function scanLiveAwsAccount(
  regions: string[],
  credentials?: AwsClientCredentials,
): Promise<{
  accountId: string;
  resources: DiscoveredAwsResource[];
  warnings: string[];
}> {
  const uniqueRegions = [...new Set(regions.filter((r) => r.trim().length > 0))];
  const primaryRegion = uniqueRegions[0] ?? "us-east-1";

  const identity = await testAwsCredentials(primaryRegion, credentials);

  const regionResults = await Promise.all(
    uniqueRegions.map((region) => scanRegion(region, identity.accountId, credentials)),
  );

  return {
    accountId: identity.accountId,
    resources: regionResults.flatMap((r) => r.resources),
    warnings: regionResults.flatMap((r) => r.warnings),
  };
}
