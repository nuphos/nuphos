import { setTimeout as delay } from 'node:timers/promises'

import { InstancesClient, ProjectsClient } from '@google-cloud/compute'
import { OsLoginServiceClient } from '@google-cloud/os-login'

import { AppError } from '@/lib/errors'

import { impersonateSa } from './gcp'
import { ensureConfigured } from './gcp-compute-shared'
import { generateEphemeralSshKey } from './ssh-keys'

import type { GcpHandle } from './gcp'

export type GcpComputeSshAccess = {
  username: string
  ipAddress: string
  privateKey: string
  certKey: null
  expiresAt: string | null
}

type MetadataItems = { key?: string | null; value?: string | null }[] | null

function readMetadataFlag(items: MetadataItems | undefined, key: string): string | null {
  for (const item of items ?? []) {
    if (item.key?.toLowerCase() === key.toLowerCase()) {
      return (item.value ?? '').trim()
    }
  }

  return null
}

function isTrueish(v: string | null): boolean {
  if (!v) return false
  const lower = v.toLowerCase()

  return lower === 'true' || lower === '1' || lower === 'yes'
}

// Imports an ephemeral SSH public key under the OS Login profile of the
// service account Nuphos is impersonating. Returns the POSIX username that
// OS Login provisioned, the instance's reachable IP, and the matching
// private key.
export async function getGceInstanceSshAccess(
  handle: GcpHandle,
  zone: string,
  name: string,
): Promise<GcpComputeSshAccess> {
  ensureConfigured()
  const impersonated = await impersonateSa(handle.serviceAccountEmail, handle.teamId)
  const authClient = impersonated as never

  // Fetch raw instance + project so we can inspect OS Login metadata. The
  // mapped `GcpComputeInstance` strips metadata fields, so call get() directly.
  const instancesClient = new InstancesClient({ authClient })
  let rawInstance: {
    status?: string | null
    metadata?: { items?: MetadataItems } | null
    networkInterfaces?:
      | {
          networkIP?: string | null
          accessConfigs?: { natIP?: string | null }[] | null
        }[]
      | null
  }

  try {
    const [inst] = await instancesClient.get({
      project: handle.projectId,
      zone,
      instance: name,
    })

    rawInstance = inst as typeof rawInstance
  } catch (e) {
    if ((e as { code?: number }).code === 5) {
      throw new AppError(404, 'gce_instance_not_found', `GCE instance ${name} not found in ${zone}`)
    }
    throw e
  }

  if (rawInstance.status !== 'RUNNING') {
    throw new AppError(
      409,
      'gce_instance_not_running',
      `GCE instance ${name} is ${rawInstance.status ?? 'unknown'}; start it before opening SSH`,
    )
  }
  const ipAddress =
    rawInstance.networkInterfaces?.[0]?.accessConfigs?.find((a) => a.natIP)?.natIP ?? null

  if (!ipAddress) {
    throw new AppError(
      400,
      'gce_no_external_ip',
      `GCE instance ${name} has no external IP; SSH from Nuphos requires a reachable address`,
    )
  }

  // Resolve effective OS Login flags: instance metadata wins, project
  // commonInstanceMetadata is the fallback. If neither sets enable-oslogin to
  // a truthy value, sshd on the box reads ~/.ssh/authorized_keys, and the
  // synthetic OS Login user (e.g. `sa_<unique-id>`) doesn't exist —
  // every login fails with "Permission denied (publickey)". Surface this
  // upfront instead of pushing a key that won't be honored.
  const instanceItems = rawInstance.metadata?.items
  let osLogin = readMetadataFlag(instanceItems, 'enable-oslogin')
  let osLogin2fa = readMetadataFlag(instanceItems, 'enable-oslogin-2fa')

  if (osLogin === null || osLogin2fa === null) {
    try {
      const projectsClient = new ProjectsClient({ authClient })
      const [project] = await projectsClient.get({ project: handle.projectId })
      const projectItems = project.commonInstanceMetadata?.items as MetadataItems

      if (osLogin === null) osLogin = readMetadataFlag(projectItems, 'enable-oslogin')
      if (osLogin2fa === null) osLogin2fa = readMetadataFlag(projectItems, 'enable-oslogin-2fa')
    } catch {
      // Read-project permission isn't strictly required; if we can't check,
      // assume the explicit error from sshd is still informative enough.
    }
  }
  if (!isTrueish(osLogin)) {
    throw new AppError(
      400,
      'os_login_not_enabled',
      `OS Login is not enabled on ${name} or its project. Nuphos SSH for GCE requires enable-oslogin=TRUE in instance or project metadata (and the service account needs roles/compute.osLogin).`,
    )
  }
  if (isTrueish(osLogin2fa)) {
    throw new AppError(
      400,
      'os_login_2fa_required',
      `OS Login 2FA (enable-oslogin-2fa=TRUE) is enabled on ${name}; Nuphos SSH cannot satisfy the second factor. Disable 2FA on this instance or use the gcloud CLI.`,
    )
  }

  const { privateKeyPem, publicKeyOpenSsh } = generateEphemeralSshKey(`atlas-${name}`)
  const expirationMicros = ((Date.now() + 5 * 60_000) * 1000).toString()

  const oslogin = new OsLoginServiceClient({ authClient })
  const [resp] = await oslogin.importSshPublicKey({
    parent: `users/${handle.serviceAccountEmail}`,
    sshPublicKey: { key: publicKeyOpenSsh, expirationTimeUsec: expirationMicros },
    projectId: handle.projectId,
  })

  const accounts = resp.loginProfile?.posixAccounts ?? []
  const posix =
    accounts.find((a) => a.primary) ??
    accounts.find((a) => a.accountId === handle.projectId) ??
    accounts[0]
  const username = posix?.username

  if (!username) {
    throw new AppError(
      400,
      'os_login_no_posix',
      'OS Login did not return a POSIX username — ensure OS Login is enabled and the service account has roles/compute.osLogin',
    )
  }

  // OS Login keys take a few seconds to propagate to the instance's local
  // authorized-key cache; without this wait the immediate SSH attempt loses
  // the race and the user sees "Permission denied (publickey)".
  await delay(6_000)

  return {
    username,
    ipAddress,
    privateKey: privateKeyPem,
    certKey: null,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  }
}
