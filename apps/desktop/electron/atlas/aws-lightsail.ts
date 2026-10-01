import { buildAwsListError } from './aws-network'
import { appendQuery, call, withAwsRole } from './client'

import type { AwsListError } from './aws-network'

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

export type AwsLightsailSshAccess = {
  username: string
  ipAddress: string
  privateKey: string
  certKey: string | null
  expiresAt: string | null
}

export type CloudSshAccess = {
  username: string
  ipAddress: string
  privateKey: string
  certKey: string | null
  expiresAt: string | null
}

export async function listAwsLightsailInstances(
  teamId: string,
  accountId: string,
  region?: string,
  roleId?: string,
): Promise<AwsLightsailInstance[]> {
  const q = appendQuery('', { region, roleId })
  const data = await call<{ instances: AwsLightsailInstance[]; errors?: AwsListError[] }>(
    'GET',
    `/teams/${teamId}/aws-accounts/${accountId}/lightsail-instances${q}`,
  )
  const instances = data.instances ?? []
  const errors = data.errors ?? []

  if (instances.length === 0 && errors.length > 0) {
    // Legacy: older backends returned regional AWS errors in a 200 body instead of a 4xx.
    throw buildAwsListError('Lightsail instances', errors)
  }

  return instances
}

export async function rebootAwsLightsailInstance(
  teamId: string,
  accountId: string,
  name: string,
  region: string,
  roleId?: string,
): Promise<void> {
  await call(
    'POST',
    withAwsRole(
      `/teams/${teamId}/aws-accounts/${accountId}/lightsail-instances/${encodeURIComponent(name)}/reboot`,
      roleId,
    ),
    { region },
  )
}

export async function getAwsLightsailSshAccess(
  teamId: string,
  accountId: string,
  name: string,
  region: string,
  roleId?: string,
): Promise<AwsLightsailSshAccess> {
  return call<AwsLightsailSshAccess>(
    'POST',
    withAwsRole(
      `/teams/${teamId}/aws-accounts/${accountId}/lightsail-instances/${encodeURIComponent(name)}/ssh-access`,
      roleId,
    ),
    { region },
  )
}

export async function getAwsEc2SshAccess(
  teamId: string,
  accountId: string,
  instanceId: string,
  region?: string,
  username?: string,
  roleId?: string,
): Promise<CloudSshAccess> {
  return call<CloudSshAccess>(
    'POST',
    withAwsRole(
      `/teams/${teamId}/aws-accounts/${accountId}/ec2-instances/${encodeURIComponent(instanceId)}/ssh-access`,
      roleId,
    ),
    { region, username },
    { retry: false },
  )
}
