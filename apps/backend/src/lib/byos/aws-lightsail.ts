import {
  GetInstanceAccessDetailsCommand,
  GetRegionsCommand,
  GetInstancesCommand,
  LightsailClient,
  RebootInstanceCommand,
} from '@aws-sdk/client-lightsail'

import { extractAwsAccountId } from './account'
import { assumeRoleAsConnector, getEnabledRegions } from './aws'
import { collectAwsRegionalList } from './aws-errors'

import type { AwsListError, TempCredentials } from './aws'
import type { Instance, InstancePortInfo, Tag } from '@aws-sdk/client-lightsail'

export type AwsLightsailPort = {
  fromPort: number | null
  toPort: number | null
  protocol: string
  accessType: string | null
  accessFrom: string | null
  cidrs: string[]
  ipv6Cidrs: string[]
}

export type AwsLightsailInstance = {
  name: string
  arn: string | null
  region: string
  availabilityZone: string | null
  state: string
  blueprintId: string | null
  blueprintName: string | null
  bundleId: string | null
  publicIp: string | null
  privateIp: string | null
  ipv6Addresses: string[]
  ipAddressType: string | null
  isStaticIp: boolean
  cpuCount: number | null
  ramSizeInGb: number | null
  username: string | null
  sshKeyName: string | null
  createdAt: string | null
  tags: Record<string, string>
  ports: AwsLightsailPort[]
}

export type AwsLightsailAccessDetails = {
  username: string
  ipAddress: string
  privateKey: string
  certKey: string | null
  expiresAt: string | null
}

const LIGHTSAIL_REGIONS_TTL_MS = 60 * 60 * 1000
const lightsailRegionsCache = new Map<string, { regions: string[]; expiresAt: number }>()

const FALLBACK_LIGHTSAIL_REGIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-2',
  'ca-central-1',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'eu-central-1',
  'eu-north-1',
  'ap-south-1',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-southeast-3',
  'ap-southeast-5',
  'ap-northeast-1',
  'ap-northeast-2',
]

function tagsToRecord(tags: Tag[] | undefined): Record<string, string> {
  const out: Record<string, string> = {}

  for (const t of tags ?? []) {
    if (t.key && t.value !== undefined) out[t.key] = t.value
  }

  return out
}

function mapPort(p: InstancePortInfo): AwsLightsailPort {
  return {
    fromPort: p.fromPort ?? null,
    toPort: p.toPort ?? null,
    protocol: p.protocol ?? 'unknown',
    accessType: p.accessType ?? null,
    accessFrom: p.accessFrom ?? null,
    cidrs: p.cidrs ?? [],
    ipv6Cidrs: p.ipv6Cidrs ?? [],
  }
}

function mapInstance(instance: Instance, fallbackRegion: string): AwsLightsailInstance | null {
  if (!instance.name) return null

  return {
    name: instance.name,
    arn: instance.arn ?? null,
    region: instance.location?.regionName ?? fallbackRegion,
    availabilityZone: instance.location?.availabilityZone ?? null,
    state: instance.state?.name ?? 'unknown',
    blueprintId: instance.blueprintId ?? null,
    blueprintName: instance.blueprintName ?? null,
    bundleId: instance.bundleId ?? null,
    publicIp: instance.publicIpAddress ?? null,
    privateIp: instance.privateIpAddress ?? null,
    ipv6Addresses: instance.ipv6Addresses ?? [],
    ipAddressType: instance.ipAddressType ?? null,
    isStaticIp: instance.isStaticIp ?? false,
    cpuCount: instance.hardware?.cpuCount ?? null,
    ramSizeInGb: instance.hardware?.ramSizeInGb ?? null,
    username: instance.username ?? null,
    sshKeyName: instance.sshKeyName ?? null,
    createdAt: instance.createdAt ? instance.createdAt.toISOString() : null,
    tags: tagsToRecord(instance.tags),
    ports: (instance.networking?.ports ?? []).map(mapPort),
  }
}

async function getLightsailRegions(accountId: string, temp: TempCredentials): Promise<string[]> {
  const cached = lightsailRegionsCache.get(accountId)

  if (cached && cached.expiresAt > Date.now()) return cached.regions

  let regions = FALLBACK_LIGHTSAIL_REGIONS

  try {
    const lightsail = new LightsailClient({ region: 'us-east-1', credentials: temp })
    const out = await lightsail.send(new GetRegionsCommand({ includeAvailabilityZones: false }))
    const discovered: string[] = []

    for (const region of out.regions ?? []) {
      if (region.name) discovered.push(region.name)
    }
    if (discovered.length > 0) regions = discovered
  } catch {
    // Some existing connector roles predate Lightsail support and cannot call
    // lightsail:GetRegions. Fall back to the SDK's known Lightsail regions so
    // the real missing permission is reported by GetInstances.
  }

  try {
    const enabled = new Set(await getEnabledRegions(accountId, temp))

    regions = regions.filter((region) => enabled.has(region))
  } catch {
    // If DescribeRegions is unavailable, scanning the Lightsail-supported
    // regions is still the best effort behavior.
  }

  lightsailRegionsCache.set(accountId, {
    regions,
    expiresAt: Date.now() + LIGHTSAIL_REGIONS_TTL_MS,
  })

  return regions
}

export async function listLightsailInstances(
  roleArn: string,
  opts?: { region?: string },
): Promise<{ instances: AwsLightsailInstance[]; errors: AwsListError[] }> {
  const accountId = extractAwsAccountId(roleArn)

  if (!accountId) {
    return {
      instances: [],
      errors: [{ message: 'Invalid roleArn (cannot extract account ID)' }],
    }
  }

  const temp = await assumeRoleAsConnector(roleArn)
  const target = opts?.region ? [opts.region] : await getLightsailRegions(accountId, temp)

  const instances = await collectAwsRegionalList(
    target,
    'lightsail:GetInstances',
    async (region) => {
      const lightsail = new LightsailClient({ region, credentials: temp })
      const rows: AwsLightsailInstance[] = []
      let pageToken: string | undefined

      do {
        const out = await lightsail.send(new GetInstancesCommand({ pageToken }))

        pageToken = out.nextPageToken
        for (const instance of out.instances ?? []) {
          const mapped = mapInstance(instance, region)

          if (mapped) rows.push(mapped)
        }
      } while (pageToken)

      return rows
    },
  )

  instances.sort((a, b) => a.region.localeCompare(b.region) || a.name.localeCompare(b.name))

  return { instances, errors: [] }
}

export async function rebootLightsailInstance(
  roleArn: string,
  region: string,
  name: string,
): Promise<void> {
  const temp = await assumeRoleAsConnector(roleArn)
  const lightsail = new LightsailClient({ region, credentials: temp })

  await lightsail.send(new RebootInstanceCommand({ instanceName: name }))
}

export async function getLightsailInstanceSshAccess(
  roleArn: string,
  region: string,
  name: string,
): Promise<AwsLightsailAccessDetails> {
  const temp = await assumeRoleAsConnector(roleArn)
  const lightsail = new LightsailClient({ region, credentials: temp })
  const out = await lightsail.send(
    new GetInstanceAccessDetailsCommand({ instanceName: name, protocol: 'ssh' }),
  )
  const details = out.accessDetails

  if (!details?.username || !details.ipAddress || !details.privateKey) {
    throw new Error(`Lightsail SSH access details are unavailable for ${name}`)
  }

  return {
    username: details.username,
    ipAddress: details.ipAddress,
    privateKey: details.privateKey,
    certKey: details.certKey ?? null,
    expiresAt: details.expiresAt ? details.expiresAt.toISOString() : null,
  }
}
