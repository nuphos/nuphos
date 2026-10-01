import { EC2Client, DescribeVpcsCommand, DescribeInstancesCommand } from '@aws-sdk/client-ec2'

import { setupForRole, tagsToRecord } from './aws-ec2-shared'
import { collectAwsRegionalList } from './aws-errors'

import type { AwsEc2Instance } from './aws-ec2-shared'
import type { Vpc } from '@aws-sdk/client-ec2'

export { listNacls, getNacl, replaceNaclEntries } from './aws-ec2-nacl'
export { getEc2InstanceSshAccess } from './aws-ec2-ssh'

export type { AwsNaclEntry, AwsNacl } from './aws-ec2-nacl'
export type { AwsEc2Instance } from './aws-ec2-shared'
export type { AwsEc2SshAccess } from './aws-ec2-ssh'

export type AwsVpc = {
  id: string
  region: string
  cidrBlock: string
  isDefault: boolean
  state: string
  tags: Record<string, string>
}

function mapVpc(v: Vpc, region: string): AwsVpc | null {
  if (!v.VpcId) return null

  return {
    id: v.VpcId,
    region,
    cidrBlock: v.CidrBlock ?? '',
    isDefault: v.IsDefault ?? false,
    state: v.State ?? 'unknown',
    tags: tagsToRecord(v.Tags),
  }
}

export async function listVpcs(roleArn: string, filter?: { region?: string }): Promise<AwsVpc[]> {
  const { temp, regions } = await setupForRole(roleArn)
  const target = filter?.region ? [filter.region] : regions

  return collectAwsRegionalList(target, 'ec2:DescribeVpcs', async (region) => {
    const ec2 = new EC2Client({ region, credentials: temp })
    const out = await ec2.send(new DescribeVpcsCommand({}))

    return (out.Vpcs ?? []).map((v) => mapVpc(v, region)).filter((v): v is AwsVpc => v !== null)
  })
}

export async function listEc2Instances(
  roleArn: string,
  opts?: { region?: string },
): Promise<AwsEc2Instance[]> {
  const { temp, regions } = await setupForRole(roleArn)
  const target = opts?.region ? [opts.region] : regions

  return collectAwsRegionalList(target, 'ec2:DescribeInstances', async (region) => {
    const ec2 = new EC2Client({ region, credentials: temp })
    const instances: AwsEc2Instance[] = []
    let nextToken: string | undefined

    do {
      const out = await ec2.send(new DescribeInstancesCommand({ NextToken: nextToken }))

      nextToken = out.NextToken
      for (const reservation of out.Reservations ?? []) {
        for (const inst of reservation.Instances ?? []) {
          if (!inst.InstanceId) continue
          const az = inst.Placement?.AvailabilityZone ?? ''
          const instRegion = az ? az.slice(0, az.length - 1) : region

          instances.push({
            instanceId: inst.InstanceId,
            instanceType: inst.InstanceType ?? '',
            state: inst.State?.Name ?? 'unknown',
            region: instRegion,
            availabilityZone: az,
            publicIp: inst.PublicIpAddress ?? null,
            privateIp: inst.PrivateIpAddress ?? null,
            launchTime: inst.LaunchTime ? inst.LaunchTime.toISOString() : null,
            platform: inst.Platform ?? null,
            imageId: inst.ImageId ?? null,
            tags: tagsToRecord(inst.Tags),
          })
        }
      }
    } while (nextToken)

    return instances
  })
}

export async function getVpc(roleArn: string, vpcId: string): Promise<AwsVpc | null> {
  const { temp, regions } = await setupForRole(roleArn)
  const results = await Promise.allSettled(
    regions.map(async (region) => {
      try {
        const ec2 = new EC2Client({ region, credentials: temp })
        const out = await ec2.send(new DescribeVpcsCommand({ VpcIds: [vpcId] }))
        const v = out.Vpcs?.[0]

        return v ? mapVpc(v, region) : null
      } catch (e) {
        if ((e as { name?: string }).name === 'InvalidVpcID.NotFound') return null
        throw e
      }
    }),
  )

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) return r.value
  }

  return null
}
