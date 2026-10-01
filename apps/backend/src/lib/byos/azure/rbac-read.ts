import { AppError } from '@/lib/errors'

import { ARM_BASE, ARM_READ_TIMEOUT_MS, ROLE_ASSIGNMENT_API_VERSION, armRequest } from './core'

import type { AzureHandle } from './core'

/**
 * The service-principal object id an ARM token was minted for — read from the
 * token's own `oid` claim. Lets an app list its OWN role assignments without a
 * Graph lookup (ARM role assignments key on the SP object id, and the app's token
 * already carries it).
 */
function objectIdFromToken(accessToken: string): string | null {
  const parts = accessToken.split('.')

  if (parts.length < 2 || !parts[1]) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8')) as {
      oid?: string
    }

    return payload.oid ?? null
  } catch {
    return null
  }
}

export type AzureRoleAssignment = {
  /** Human role name, e.g. "Reader" / "Contributor". */
  roleName: string
  /** Built-in role definition GUID. */
  roleDefinitionId: string
  /** ARM scope the assignment applies at (subscription / resource group / resource). */
  scope: string
}

/**
 * List the role assignments the binding's app holds — the "what can this app do"
 * view (the analog of an AWS role's attached policies). Reads the app's own SP
 * object id from its ARM token's `oid` claim (no Graph needed), lists role
 * assignments filtered to that principal, and resolves each role definition to
 * its display name.
 */
export async function listAzureRoleAssignments(
  handle: AzureHandle,
): Promise<AzureRoleAssignment[]> {
  const oid = objectIdFromToken(handle.accessToken)

  if (!oid) {
    throw new AppError(
      502,
      'azure_arm_error',
      'Could not read the app object id from its access token',
    )
  }
  const assignments = await listRoleAssignmentsForPrincipal(handle, handle.subscriptionId, oid)
  const out: AzureRoleAssignment[] = []
  const nameCache = new Map<string, string>()

  for (const a of assignments) {
    const roleDefId = a.properties?.roleDefinitionId

    if (!roleDefId) continue
    const guid = roleDefId.split('/').pop() ?? roleDefId
    let roleName = nameCache.get(roleDefId)

    if (!roleName) {
      try {
        const rd = await armRequest<{ properties?: { roleName?: string } }>(handle, roleDefId, {
          apiVersion: ROLE_ASSIGNMENT_API_VERSION,
        })

        roleName = rd.properties?.roleName ?? guid
      } catch {
        // A role definition we can't read (e.g. a custom role at a higher scope)
        // still lists — fall back to its GUID rather than dropping the row.
        roleName = guid
      }
      nameCache.set(roleDefId, roleName)
    }
    out.push({ roleName, roleDefinitionId: guid, scope: a.properties?.scope ?? '' })
  }

  return out
}

export type RoleAssignmentEntry = {
  id?: string
  name?: string
  properties?: { roleDefinitionId?: string; principalId?: string; scope?: string }
}

/**
 * List every role assignment for a principal at the subscription scope,
 * following `nextLink` so a large result set isn't silently truncated (which
 * would let a revoke miss an assignment that sits on a later page).
 */
export async function listRoleAssignmentsForPrincipal(
  handle: AzureHandle,
  subscriptionId: string,
  principalId: string,
): Promise<RoleAssignmentEntry[]> {
  type RaListPage = {
    value?: RoleAssignmentEntry[]
    nextLink?: string
    error?: { code?: string; message?: string }
  }
  const out: RoleAssignmentEntry[] = []
  let url: string | null =
    `${ARM_BASE}/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleAssignments` +
    `?$filter=principalId+eq+'${principalId}'&api-version=${ROLE_ASSIGNMENT_API_VERSION}`

  while (url !== null) {
    const r: Response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${handle.accessToken}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(ARM_READ_TIMEOUT_MS),
    })
    const text: string = await r.text()
    const json: RaListPage = text ? (JSON.parse(text) as RaListPage) : {}

    if (!r.ok) {
      throw new AppError(
        r.status === 401 || r.status === 403 ? 403 : 502,
        r.status === 401 || r.status === 403 ? 'azure_permission_denied' : 'azure_arm_error',
        json.error?.message ?? `Azure roleAssignments list failed (${String(r.status)})`,
        { upstreamCode: json.error?.code },
      )
    }
    out.push(...(json.value ?? []))
    url = json.nextLink ?? null
  }

  return out
}
