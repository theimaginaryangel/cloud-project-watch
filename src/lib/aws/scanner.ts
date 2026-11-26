import {
  DescribeAddressesCommand,
  DescribeInstancesCommand,
  DescribeNatGatewaysCommand,
  DescribeVolumesCommand,
  EC2Client,
  type Instance,
  type NatGateway,
  type Volume,
} from "@aws-sdk/client-ec2";
import {
  DescribeLoadBalancersCommand,
  DescribeTagsCommand as DescribeElbTagsCommand,
  ElasticLoadBalancingV2Client,
  type LoadBalancer,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import {
  DescribeDBInstancesCommand,
  RDSClient,
  type DBInstance,
} from "@aws-sdk/client-rds";
import {
  GetResourcesCommand,
  ResourceGroupsTaggingAPIClient,
} from "@aws-sdk/client-resource-groups-tagging-api";
import {
  ListSecretsCommand,
  SecretsManagerClient,
  type SecretListEntry,
} from "@aws-sdk/client-secrets-manager";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import type { DiscoveredAwsResource } from "@/lib/domain/types";

export interface AwsClientCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_PAGES_PER_SERVICE = 20;

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

function formatWarningReason(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.name ? `${reason.name}` : "request failed";
  }
  return "request failed";
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
): Promise<{ tagMap: Map<string, Record<string, string>>; truncated: boolean }> {
  const tagMap = new Map<string, Record<string, string>>();
  const client = new ResourceGroupsTaggingAPIClient(clientConfig(region, credentials));

  let paginationToken: string | undefined;
  let pages = 0;

  while (pages < MAX_PAGES_PER_SERVICE) {
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

    if (!res.PaginationToken) {
      return { tagMap, truncated: false };
    }
    paginationToken = res.PaginationToken;
  }

  return { tagMap, truncated: Boolean(paginationToken) };
}

async function fetchAllEc2Instances(ec2: EC2Client): Promise<{ items: Instance[]; truncated: boolean }> {
  const items: Instance[] = [];
  let nextToken: string | undefined;
  let pages = 0;

  while (pages < MAX_PAGES_PER_SERVICE) {
    pages += 1;
    const res = await ec2.send(
      new DescribeInstancesCommand({ MaxResults: 200, NextToken: nextToken }),
      { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    );
    for (const reservation of res.Reservations ?? []) {
      if (reservation.Instances) items.push(...reservation.Instances);
    }
    if (!res.NextToken) return { items, truncated: false };
    nextToken = res.NextToken;
  }
  return { items, truncated: Boolean(nextToken) };
}

async function fetchAllEbsVolumes(ec2: EC2Client): Promise<{ items: Volume[]; truncated: boolean }> {
  const items: Volume[] = [];
  let nextToken: string | undefined;
  let pages = 0;

  while (pages < MAX_PAGES_PER_SERVICE) {
    pages += 1;
    const res = await ec2.send(
      new DescribeVolumesCommand({ MaxResults: 200, NextToken: nextToken }),
      { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    );
    if (res.Volumes) items.push(...res.Volumes);
    if (!res.NextToken) return { items, truncated: false };
    nextToken = res.NextToken;
  }
  return { items, truncated: Boolean(nextToken) };
}

async function fetchAllNatGateways(ec2: EC2Client): Promise<{ items: NatGateway[]; truncated: boolean }> {
  const items: NatGateway[] = [];
  let nextToken: string | undefined;
  let pages = 0;

  while (pages < MAX_PAGES_PER_SERVICE) {
    pages += 1;
    const res = await ec2.send(
      new DescribeNatGatewaysCommand({ MaxResults: 100, NextToken: nextToken }),
      { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    );
    if (res.NatGateways) items.push(...res.NatGateways);
    if (!res.NextToken) return { items, truncated: false };
    nextToken = res.NextToken;
  }
  return { items, truncated: Boolean(nextToken) };
}

async function fetchAllRdsInstances(rds: RDSClient): Promise<{ items: DBInstance[]; truncated: boolean }> {
  const items: DBInstance[] = [];
  let marker: string | undefined;
  let pages = 0;

  while (pages < MAX_PAGES_PER_SERVICE) {
    pages += 1;
    const res = await rds.send(
      new DescribeDBInstancesCommand({ MaxRecords: 100, Marker: marker }),
      { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    );
    if (res.DBInstances) items.push(...res.DBInstances);
    if (!res.Marker) return { items, truncated: false };
    marker = res.Marker;
  }
  return { items, truncated: Boolean(marker) };
}

async function fetchAllSecrets(
  secrets: SecretsManagerClient,
): Promise<{ items: SecretListEntry[]; truncated: boolean }> {
  const items: SecretListEntry[] = [];
  let nextToken: string | undefined;
  let pages = 0;

  while (pages < MAX_PAGES_PER_SERVICE) {
    pages += 1;
    const res = await secrets.send(
      new ListSecretsCommand({ MaxResults: 100, NextToken: nextToken }),
      { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    );
    if (res.SecretList) items.push(...res.SecretList);
    if (!res.NextToken) return { items, truncated: false };
    nextToken = res.NextToken;
  }
  return { items, truncated: Boolean(nextToken) };
}

async function fetchAllLoadBalancers(
  elb: ElasticLoadBalancingV2Client,
): Promise<{ items: LoadBalancer[]; truncated: boolean }> {
  const items: LoadBalancer[] = [];
  let marker: string | undefined;
  let pages = 0;

  while (pages < MAX_PAGES_PER_SERVICE) {
    pages += 1;
    const res = await elb.send(
      new DescribeLoadBalancersCommand({ PageSize: 100, Marker: marker }),
      { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    );
    if (res.LoadBalancers) items.push(...res.LoadBalancers);
    if (!res.NextMarker) return { items, truncated: false };
    marker = res.NextMarker;
  }
  return { items, truncated: Boolean(marker) };
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
    fetchAllEc2Instances(ec2),
    ec2.send(new DescribeAddressesCommand({}), {
      abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }),
    fetchAllEbsVolumes(ec2),
    fetchAllNatGateways(ec2),
    fetchAllRdsInstances(rds),
    fetchAllSecrets(secrets),
    fetchAllLoadBalancers(elb),
  ]);

  const warnings: string[] = [];
  const resources: DiscoveredAwsResource[] = [];
  const tagMap =
    tagMapResult.status === "fulfilled"
      ? tagMapResult.value.tagMap
      : new Map<string, Record<string, string>>();

  if (tagMapResult.status === "rejected") {
    warnings.push(`[${region}] Tagging API skipped (${formatWarningReason(tagMapResult.reason)})`);
  } else if (tagMapResult.value.truncated) {
    warnings.push(`[${region}] Resource tag listing reached ${MAX_PAGES_PER_SERVICE}-page safety cap.`);
  }

  // 1. EC2 Instances
  if (instancesResult.status === "fulfilled") {
    if (instancesResult.value.truncated) {
      warnings.push(`[${region}] EC2 instances truncated at ${MAX_PAGES_PER_SERVICE} pages.`);
    }
    for (const inst of instancesResult.value.items) {
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
  } else {
    warnings.push(`[${region}] EC2 instances skipped (${formatWarningReason(instancesResult.reason)})`);
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
    warnings.push(`[${region}] Elastic IPs skipped (${formatWarningReason(addressesResult.reason)})`);
  }

  // 3. EBS Volumes
  if (volumesResult.status === "fulfilled") {
    if (volumesResult.value.truncated) {
      warnings.push(`[${region}] EBS volumes truncated at ${MAX_PAGES_PER_SERVICE} pages.`);
    }
    for (const vol of volumesResult.value.items) {
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
    warnings.push(`[${region}] EBS volumes skipped (${formatWarningReason(volumesResult.reason)})`);
  }

  // 4. NAT Gateways
  if (natsResult.status === "fulfilled") {
    if (natsResult.value.truncated) {
      warnings.push(`[${region}] NAT gateways truncated at ${MAX_PAGES_PER_SERVICE} pages.`);
    }
    for (const nat of natsResult.value.items) {
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
    warnings.push(`[${region}] NAT gateways skipped (${formatWarningReason(natsResult.reason)})`);
  }

  // 5. RDS DB Instances
  if (rdsResult.status === "fulfilled") {
    if (rdsResult.value.truncated) {
      warnings.push(`[${region}] RDS instances truncated at ${MAX_PAGES_PER_SERVICE} pages.`);
    }
    for (const db of rdsResult.value.items) {
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
    warnings.push(`[${region}] RDS skipped (${formatWarningReason(rdsResult.reason)})`);
  }

  // 6. Secrets Manager
  if (secretsResult.status === "fulfilled") {
    if (secretsResult.value.truncated) {
      warnings.push(`[${region}] Secrets Manager truncated at ${MAX_PAGES_PER_SERVICE} pages.`);
    }
    for (const secret of secretsResult.value.items) {
      if (secret.DeletedDate) continue;
      const arn =
        secret.ARN ?? `arn:aws:secretsmanager:${region}:${accountId}:secret:${secret.Name}`;
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
    warnings.push(`[${region}] Secrets Manager skipped (${formatWarningReason(secretsResult.reason)})`);
  }

  // 7. ELBv2 Load Balancers (chunk DescribeTags in batches of 20 per AWS API limit)
  if (elbsResult.status === "fulfilled") {
    if (elbsResult.value.truncated) {
      warnings.push(`[${region}] Load balancers truncated at ${MAX_PAGES_PER_SERVICE} pages.`);
    }
    const lbs = elbsResult.value.items;
    const lbArns = lbs.map((lb) => lb.LoadBalancerArn).filter((a): a is string => Boolean(a));
    const elbTagMap = new Map<string, Record<string, string>>();

    for (let offset = 0; offset < lbArns.length; offset += 20) {
      const batch = lbArns.slice(offset, offset + 20);
      try {
        const tagRes = await elb.send(
          new DescribeElbTagsCommand({ ResourceArns: batch }),
          { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
        );
        for (const desc of tagRes.TagDescriptions ?? []) {
          if (desc.ResourceArn) {
            elbTagMap.set(desc.ResourceArn, toTagRecord(desc.Tags));
          }
        }
      } catch {
        // Fallback to ResourceGroupsTaggingAPI map when DescribeTags is not permitted
        break;
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
    warnings.push(`[${region}] ELB skipped (${formatWarningReason(elbsResult.reason)})`);
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
