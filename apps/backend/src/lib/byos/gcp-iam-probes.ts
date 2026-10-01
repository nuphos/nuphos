import { fetchJson } from './gcp-iam-http'

import type { SelfCapabilities, ServiceAccountCapabilities } from './gcp-iam-types'

export const ROLE_PERMISSION_CAP = 200

// Curated probe for testIamPermissions when getIamPolicy is denied. Covers the
// resources Nuphos actually touches: GKE, Compute, IAM/service accounts,
// Resource Manager, and read-side observability. testIamPermissions accepts up
// to 100 permissions per call, so this list is kept under that ceiling.
export const PROBE_PERMISSIONS: string[] = [
  // Resource Manager / project metadata
  'resourcemanager.projects.get',
  'resourcemanager.projects.getIamPolicy',
  'resourcemanager.projects.setIamPolicy',
  // GKE
  'container.clusters.list',
  'container.clusters.get',
  'container.clusters.create',
  'container.clusters.update',
  'container.clusters.delete',
  'container.operations.get',
  'container.nodes.list',
  'container.pods.list',
  // Compute — networks, firewalls, VMs
  'compute.networks.list',
  'compute.networks.get',
  'compute.networks.create',
  'compute.subnetworks.list',
  'compute.subnetworks.get',
  'compute.firewalls.list',
  'compute.firewalls.get',
  'compute.firewalls.create',
  'compute.firewalls.update',
  'compute.firewalls.delete',
  'compute.instances.list',
  'compute.instances.get',
  'compute.instances.start',
  'compute.instances.stop',
  'compute.instances.reset',
  'compute.disks.list',
  'compute.disks.get',
  'compute.routes.list',
  'compute.addresses.list',
  'compute.regions.list',
  'compute.zones.list',
  // IAM / service accounts
  'iam.serviceAccounts.get',
  'iam.serviceAccounts.list',
  'iam.serviceAccounts.create',
  'iam.serviceAccounts.update',
  'iam.serviceAccounts.delete',
  'iam.serviceAccounts.actAs',
  'iam.serviceAccounts.getIamPolicy',
  'iam.serviceAccounts.setIamPolicy',
  'iam.roles.get',
  'iam.roles.list',
  // Lives in roles/iam.roleAdmin, NOT roles/resourcemanager.projectIamAdmin.
  'iam.roles.create',
  // Logging / monitoring (observability tab)
  'logging.logEntries.list',
  'monitoring.timeSeries.list',
  'monitoring.metricDescriptors.list',
  'monitoring.dashboards.list',
  'monitoring.dashboards.get',
  // Storage (for backups / template state)
  'storage.buckets.list',
  'storage.buckets.get',
  'storage.objects.list',
  'storage.objects.get',
  // Service usage
  'serviceusage.services.list',
  'serviceusage.services.get',
]

export async function probeGcpServiceAccountCapabilities({
  projectId,
  headers,
  effectivePermissions,
}: {
  projectId: string
  headers: Record<string, string>
  effectivePermissions: string[] | null
}): Promise<ServiceAccountCapabilities> {
  const targetPermissions = [
    'iam.serviceAccounts.create',
    'iam.serviceAccounts.update',
    'iam.serviceAccounts.delete',
    'iam.serviceAccounts.setIamPolicy',
  ]
  let have = effectivePermissions

  if (have === null) {
    const url = `https://cloudresourcemanager.googleapis.com/v3/projects/${encodeURIComponent(projectId)}:testIamPermissions`
    const res = await fetchJson<{ permissions?: string[] }>(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ permissions: targetPermissions }),
    })

    have = res.ok && res.data ? (res.data.permissions ?? []) : null
  }
  if (have === null) {
    return {
      canCreate: false,
      canUpdate: false,
      canDelete: false,
      canSetIamPolicy: false,
      reason:
        'Could not determine service-account management capability: testIamPermissions failed.',
    }
  }
  const missing = targetPermissions.filter((permission) => !have.includes(permission))

  return {
    canCreate: have.includes('iam.serviceAccounts.create'),
    canUpdate: have.includes('iam.serviceAccounts.update'),
    canDelete: have.includes('iam.serviceAccounts.delete'),
    canSetIamPolicy: have.includes('iam.serviceAccounts.setIamPolicy'),
    reason:
      missing.length === 0
        ? 'SA has the project-level permissions needed to create, update, delete, and edit IAM policies for service accounts.'
        : `Missing ${missing.join(', ')} on this project.`,
  }
}

export async function probeGcpSelfCapabilities({
  projectId,
  headers,
  getIamPolicyKnownToWork,
  effectivePermissions,
}: {
  projectId: string
  headers: Record<string, string>
  getIamPolicyKnownToWork: boolean
  effectivePermissions: string[] | null
}): Promise<SelfCapabilities> {
  // Re-use a probe we may already have made — but if we did, it covered the
  // self-management perms because PROBE_PERMISSIONS includes them.
  let have = effectivePermissions

  if (have === null) {
    const url = `https://cloudresourcemanager.googleapis.com/v3/projects/${encodeURIComponent(projectId)}:testIamPermissions`
    const res = await fetchJson<{ permissions?: string[] }>(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        permissions: [
          'resourcemanager.projects.getIamPolicy',
          'resourcemanager.projects.setIamPolicy',
        ],
      }),
    })

    have = res.ok && res.data ? (res.data.permissions ?? []) : null
  }

  if (have === null) {
    return {
      canRead: getIamPolicyKnownToWork,
      canWrite: false,
      inferred: true,
      readReason: getIamPolicyKnownToWork
        ? 'getIamPolicy succeeded, so the SA can read its own bindings.'
        : 'Could not determine: testIamPermissions itself was denied.',
      writeReason:
        'Could not determine: testIamPermissions itself was denied — write capability unknown.',
    }
  }

  const canRead = getIamPolicyKnownToWork || have.includes('resourcemanager.projects.getIamPolicy')
  const canWrite = have.includes('resourcemanager.projects.setIamPolicy')

  return {
    canRead,
    canWrite,
    inferred: false,
    readReason: canRead
      ? 'SA has resourcemanager.projects.getIamPolicy on this project.'
      : 'SA lacks resourcemanager.projects.getIamPolicy — it cannot see its own bindings.',
    writeReason: canWrite
      ? "SA has resourcemanager.projects.setIamPolicy on this project — you can adjust Nuphos's bindings from this SA without re-binding the project."
      : "SA lacks resourcemanager.projects.setIamPolicy — to change Nuphos's roles you'll need a project IAM admin.",
  }
}
