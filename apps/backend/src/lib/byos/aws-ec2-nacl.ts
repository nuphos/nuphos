import {
  EC2Client,
  DescribeNetworkAclsCommand,
  CreateNetworkAclEntryCommand,
  DeleteNetworkAclEntryCommand,
  ReplaceNetworkAclEntryCommand,
} from '@aws-sdk/client-ec2'

import { assumeRoleAsConnector } from './aws'
import { setupForRole } from './aws-ec2-shared'
import { collectAwsRegionalList } from './aws-errors'

import type { NetworkAcl } from '@aws-sdk/client-ec2'

export type AwsNaclEntry = {
  ruleNumber: number
  ruleAction: 'allow' | 'deny'
  egress: boolean
  protocol: string
  cidrBlock?: string
  ipv6CidrBlock?: string
  portRange?: { from: number; to: number }
}

export type AwsNacl = {
  id: string
  region: string
  vpcId: string
  isDefault: boolean
  entries: AwsNaclEntry[]
  associations: { subnetId: string }[]
}

const NACL_DEFAULT_RULE_NUMBER = 32767

function mapNacl(n: NetworkAcl, region: string): AwsNacl | null {
  if (!n.NetworkAclId || !n.VpcId) return null
  const entries: AwsNaclEntry[] = (n.Entries ?? []).map((e) => ({
    ruleNumber: e.RuleNumber ?? 0,
    ruleAction: (e.RuleAction ?? 'deny') as 'allow' | 'deny',
    egress: e.Egress ?? false,
    protocol: e.Protocol ?? '-1',
    cidrBlock: e.CidrBlock ?? undefined,
    ipv6CidrBlock: e.Ipv6CidrBlock ?? undefined,
    portRange:
      e.PortRange?.From != null && e.PortRange?.To != null
        ? { from: e.PortRange.From, to: e.PortRange.To }
        : undefined,
  }))
  const associations = (n.Associations ?? [])
    .map((a) => (a.SubnetId ? { subnetId: a.SubnetId } : null))
    .filter((a): a is { subnetId: string } => a !== null)

  return {
    id: n.NetworkAclId,
    region,
    vpcId: n.VpcId,
    isDefault: n.IsDefault ?? false,
    entries,
    associations,
  }
}

export async function listNacls(
  roleArn: string,
  filter?: { vpcId?: string; region?: string },
): Promise<AwsNacl[]> {
  const { temp, regions } = await setupForRole(roleArn)
  const target = filter?.region ? [filter.region] : regions
  const filters = filter?.vpcId ? [{ Name: 'vpc-id', Values: [filter.vpcId] }] : undefined

  return collectAwsRegionalList(target, 'ec2:DescribeNetworkAcls', async (region) => {
    const ec2 = new EC2Client({ region, credentials: temp })
    const out = await ec2.send(new DescribeNetworkAclsCommand({ Filters: filters }))

    return (out.NetworkAcls ?? [])
      .map((n) => mapNacl(n, region))
      .filter((n): n is AwsNacl => n !== null)
  })
}

export async function getNacl(roleArn: string, naclId: string): Promise<AwsNacl | null> {
  const { temp, regions } = await setupForRole(roleArn)
  const results = await Promise.allSettled(
    regions.map(async (region) => {
      try {
        const ec2 = new EC2Client({ region, credentials: temp })
        const out = await ec2.send(new DescribeNetworkAclsCommand({ NetworkAclIds: [naclId] }))
        const n = out.NetworkAcls?.[0]

        return n ? mapNacl(n, region) : null
      } catch (e) {
        if ((e as { name?: string }).name === 'InvalidNetworkAclID.NotFound') return null
        throw e
      }
    }),
  )

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) return r.value
  }

  return null
}

export async function replaceNaclEntries(
  roleArn: string,
  naclId: string,
  desired: AwsNaclEntry[],
): Promise<AwsNacl> {
  const current = await getNacl(roleArn, naclId)

  if (!current) throw new Error(`NACL ${naclId} not found`)

  const temp = await assumeRoleAsConnector(roleArn)
  const ec2 = new EC2Client({ region: current.region, credentials: temp })

  const keyOf = (e: { ruleNumber: number; egress: boolean }) =>
    `${String(e.ruleNumber)}|${String(e.egress)}`
  const currentByKey = new Map<string, AwsNaclEntry>()

  for (const e of current.entries) {
    if (e.ruleNumber === NACL_DEFAULT_RULE_NUMBER) continue
    currentByKey.set(keyOf(e), e)
  }
  const desiredByKey = new Map<string, AwsNaclEntry>()

  for (const e of desired) {
    if (e.ruleNumber === NACL_DEFAULT_RULE_NUMBER) {
      throw new Error(`Cannot modify default rule ${String(NACL_DEFAULT_RULE_NUMBER)}`)
    }
    desiredByKey.set(keyOf(e), e)
  }

  for (const [key, want] of desiredByKey) {
    const portRange = want.portRange
      ? { From: want.portRange.from, To: want.portRange.to }
      : undefined
    const params = {
      NetworkAclId: naclId,
      RuleNumber: want.ruleNumber,
      RuleAction: want.ruleAction,
      Egress: want.egress,
      Protocol: want.protocol,
      CidrBlock: want.cidrBlock,
      Ipv6CidrBlock: want.ipv6CidrBlock,
      PortRange: portRange,
    }

    if (currentByKey.has(key)) {
      await ec2.send(new ReplaceNetworkAclEntryCommand(params))
    } else {
      await ec2.send(new CreateNetworkAclEntryCommand(params))
    }
  }

  for (const [key, have] of currentByKey) {
    if (desiredByKey.has(key)) continue
    await ec2.send(
      new DeleteNetworkAclEntryCommand({
        NetworkAclId: naclId,
        RuleNumber: have.ruleNumber,
        Egress: have.egress,
      }),
    )
  }

  const updated = await getNacl(roleArn, naclId)

  if (!updated) throw new Error('Failed to re-fetch NACL after update')

  return updated
}
