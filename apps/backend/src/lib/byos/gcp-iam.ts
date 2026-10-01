import { fetchJson, impersonateWithRetry } from './gcp-iam-http'
import {
  PROBE_PERMISSIONS,
  probeGcpSelfCapabilities,
  probeGcpServiceAccountCapabilities,
  ROLE_PERMISSION_CAP,
} from './gcp-iam-probes'

import type { GcpHandle } from './gcp'
import type {
  GcpIamPermissions,
  GcpRoleBinding,
  GcpRoleDetails,
  IamRoleResponse,
  ProjectIamPolicy,
} from './gcp-iam-types'

export type {
  GcpIamPermissions,
  GcpRoleBinding,
  GcpRoleDetails,
  SelfCapabilities,
  ServiceAccountCapabilities,
} from './gcp-iam-types'

function memberMatchesSa(member: string, serviceAccountEmail: string): boolean {
  const lc = member.toLowerCase()
  const sa = serviceAccountEmail.toLowerCase()

  if (lc === `serviceaccount:${sa}`) return true
  // Also surface bindings that grant access to all service accounts, owners,
  // etc., since those *do* apply to the SA even if it's not named.
  if (lc === 'allauthenticatedusers' || lc === 'allusers') return true

  return false
}

export async function getGcpIamPermissions(handle: GcpHandle): Promise<GcpIamPermissions> {
  // Impersonation is the first thing that can fail (e.g. customer removed
  // iam.serviceAccounts.getAccessToken on the bound SA). Return the
  // partial-results shape with a warning so the page can still diagnose
  // the misconfiguration instead of 500-ing.
  let token: string

  try {
    token = await impersonateWithRetry(handle.serviceAccountEmail, handle.teamId)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)

    return {
      projectId: handle.projectId,
      serviceAccountEmail: handle.serviceAccountEmail,
      warnings: [
        `Failed to impersonate service account — Nuphos may lack iam.serviceAccounts.getAccessToken on this SA: ${msg}`,
      ],
      bindings: [],
      roles: [],
      effectivePermissions: null,
      selfCapabilities: {
        canRead: false,
        canWrite: false,
        inferred: true,
        readReason: 'Could not impersonate the SA, so self-introspection could not be checked.',
        writeReason:
          'Could not impersonate the SA, so self-modification capability could not be checked.',
      },
      serviceAccountCapabilities: {
        canCreate: false,
        canUpdate: false,
        canDelete: false,
        canSetIamPolicy: false,
        reason:
          'Could not impersonate the SA, so service-account management permissions could not be checked.',
      },
    }
  }
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }

  const warnings: string[] = []

  // getIamPolicy is a POST in Resource Manager v3.
  const projectPolicyUrl = `https://cloudresourcemanager.googleapis.com/v3/projects/${encodeURIComponent(
    handle.projectId,
  )}:getIamPolicy`
  const policyRes = await fetchJson<ProjectIamPolicy>(projectPolicyUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ options: { requestedPolicyVersion: 3 } }),
  })

  const bindings: GcpRoleBinding[] = []

  if (!policyRes.ok) {
    warnings.push(
      `cloudresourcemanager.projects.getIamPolicy failed (${String(policyRes.status)}): ${
        policyRes.errorText ?? 'unknown error'
      }`,
    )
  } else if (policyRes.data?.bindings) {
    for (const b of policyRes.data.bindings) {
      if (!b.role) continue
      const matched = (b.members ?? []).filter((m) =>
        memberMatchesSa(m, handle.serviceAccountEmail),
      )

      for (const member of matched) {
        bindings.push({
          role: b.role,
          member,
          ...(b.condition ? { condition: b.condition } : {}),
        })
      }
    }
  }

  // Fallback: if we couldn't read the IAM policy (e.g. SA lacks
  // resourcemanager.projects.getIamPolicy), probe a curated set with
  // testIamPermissions so the UI can still show what the SA can do.
  let effectivePermissions: string[] | null = null

  if (!policyRes.ok) {
    const testUrl = `https://cloudresourcemanager.googleapis.com/v3/projects/${encodeURIComponent(
      handle.projectId,
    )}:testIamPermissions`
    const probeRes = await fetchJson<{ permissions?: string[] }>(testUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ permissions: PROBE_PERMISSIONS }),
    })

    if (probeRes.ok && probeRes.data) {
      effectivePermissions = probeRes.data.permissions ?? []
    } else {
      warnings.push(
        `cloudresourcemanager.projects.testIamPermissions failed (${String(probeRes.status)}): ${
          probeRes.errorText ?? 'unknown error'
        }`,
      )
    }
  }

  const uniqueRoles = Array.from(new Set(bindings.map((b) => b.role)))
  const roles: GcpRoleDetails[] = await Promise.all(
    uniqueRoles.map(async (roleName) => {
      // Predefined roles live at https://iam.googleapis.com/v1/roles/{name},
      // custom roles at https://iam.googleapis.com/v1/{full-resource-name} —
      // and `roleName` already carries whichever of the two applies.
      const url = `https://iam.googleapis.com/v1/${roleName}`
      const res = await fetchJson<IamRoleResponse>(url, { headers })

      if (!res.ok || !res.data) {
        return {
          name: roleName,
          title: null,
          description: null,
          stage: null,
          includedPermissions: [],
          truncated: false,
          error: res.errorText ?? `HTTP ${String(res.status)}`,
        }
      }
      const perms = res.data.includedPermissions ?? []
      const truncated = perms.length > ROLE_PERMISSION_CAP

      return {
        name: roleName,
        title: res.data.title ?? null,
        description: res.data.description ?? null,
        stage: res.data.stage ?? null,
        includedPermissions: truncated ? perms.slice(0, ROLE_PERMISSION_CAP) : perms,
        truncated,
        error: null,
      }
    }),
  )

  // Self-capability probe: always check whether the SA can read and write
  // its own IAM policy on this project. testIamPermissions is the
  // authoritative answer; it works even when getIamPolicy doesn't.
  const selfCapabilities = await probeGcpSelfCapabilities({
    projectId: handle.projectId,
    headers,
    getIamPolicyKnownToWork: policyRes.ok,
    effectivePermissions,
  })
  const serviceAccountCapabilities = await probeGcpServiceAccountCapabilities({
    projectId: handle.projectId,
    headers,
    effectivePermissions,
  })

  return {
    projectId: handle.projectId,
    serviceAccountEmail: handle.serviceAccountEmail,
    warnings,
    bindings,
    roles,
    effectivePermissions,
    selfCapabilities,
    serviceAccountCapabilities,
  }
}
