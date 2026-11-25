import type { AwsService } from "@/lib/domain/types";

export function buildAwsConsoleUrl(
  service: AwsService,
  region: string,
  resourceId: string,
): string {
  const r = encodeURIComponent(region || "us-east-1");
  const id = encodeURIComponent(resourceId);

  switch (service) {
    case "ec2":
      return `https://${r}.console.aws.amazon.com/ec2/home?region=${r}#InstanceDetails:instanceId=${id}`;
    case "ebs":
      return `https://${r}.console.aws.amazon.com/ec2/home?region=${r}#VolumeDetails:volumeId=${id}`;
    case "eip":
      return `https://${r}.console.aws.amazon.com/ec2/home?region=${r}#Addresses:`;
    case "nat_gateway":
      return `https://${r}.console.aws.amazon.com/vpc/home?region=${r}#NatGatewayDetails:natGatewayId=${id}`;
    case "rds":
      return `https://${r}.console.aws.amazon.com/rds/home?region=${r}#database:id=${id}`;
    case "secrets_manager":
      return `https://${r}.console.aws.amazon.com/secretsmanager/secret?name=${id}&region=${r}`;
    case "elb":
      return `https://${r}.console.aws.amazon.com/ec2/home?region=${r}#LoadBalancers:`;
  }
}
