import { ObjectId } from 'mongodb'

import { accessView, canUseAllowList, createDefaultAccess } from '@/lib/byos/access'
import {
  extractAwsAccountId,
  findAwsBindingByRoleArn,
  findAwsOidcTeamForRoleArn,
} from '@/lib/byos/account'
import { assumeRoleWithWebIdentityForTeam, getAwsAccountAlias } from '@/lib/byos/aws'
import { isAwsOidcConfigured } from '@/lib/byos/aws-oidc'
import { awsConnectorSchema } from '@/lib/byos/connector-schemas'
import { appendEnvironmentBinding } from '@/lib/byos/environment-bindings'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { teamByosBindings } from '@/models'

import type { TempCredentials } from '@/lib/byos/aws'
import type { TeamAuthVariables } from '@/middleware/auth'
import type { AwsRoleBinding } from '@/models'
import type { Hono } from 'hono'

// Confirm the Nuphos connector can actually assume the role before we persist
// the binding. Without this, a role with a missing/incorrect trust policy binds
// successfully (201) and only fails much later when something tries to use it —
// a confusing, hard-to-trace failure. IAM trust-policy edits can take a few
// seconds to propagate, so retry briefly before declaring it unassumable.
//
// OIDC web identity pins the trust policy to this team's `sub`, making the
// binding confused-deputy-safe without any long-lived AWS credentials.
async function verifyRoleAssumable(teamId: ObjectId, roleArn: string): Promise<TempCredentials> {
  const probe = { sessionName: 'nuphos-bind-verify', durationSec: 900 }

  if (!isAwsOidcConfigured()) {
    throw new AppError(
      500,
      'connector_not_configured',
      'AWS BYOS OIDC connector is not configured on this server',
    )
  }
  const maxAttempts = 3
  let lastErr: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Assume with the shortest STS lifetime (900s) to minimize the orphaned session.
    try {
      return await assumeRoleWithWebIdentityForTeam(teamId.toHexString(), roleArn, probe)
    } catch (e) {
      lastErr = e
    }
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }
  const name = (lastErr as { name?: string }).name ?? 'Error'
  const message = lastErr instanceof Error ? lastErr.message : String(lastErr)

  throw new AppError(
    400,
    'role_not_assumable',
    `Nuphos cannot assume ${roleArn}. Its trust policy must trust the Nuphos OIDC identity provider for sts:AssumeRoleWithWebIdentity with sub "nuphos:team:${teamId.toHexString()}". (${name}: ${message})`,
    { roleArn, awsError: name },
  )
}

// Shared by the list GET below and the aggregated /connectors endpoint.
export async function awsAccountsView(
  bindings: AwsRoleBinding[] | undefined,
  userId: string,
  teamRole: string,
) {
  const isAdmin = teamRole === 'ADMINISTRATOR'
  const valid = (bindings ?? []).filter((b) => extractAwsAccountId(b.roleArn) !== null)
  const visibleBindings = isAdmin
    ? valid
    : valid.filter((b) => canUseAllowList(b.access?.memberAllowList, userId))

  return Promise.all(
    visibleBindings.map(async (b) => {
      const accountId = extractAwsAccountId(b.roleArn)!
      const alias = await getAwsAccountAlias(b.roleArn).catch(() => null)

      return {
        roleId: b.id.toHexString(),
        accountId,
        alias,
        roleArn: b.roleArn,
        // The ACL (allow list + updatedAt/updatedBy) is admin-only metadata —
        // /access is admin-gated, so don't leak it to members in the list.
        ...(isAdmin ? { access: accessView(b.access) } : {}),
        canUse: canUseAllowList(b.access?.memberAllowList, userId),
        createdAt: b.createdAt,
        purpose: b.purpose ?? null,
      }
    }),
  )
}

export function registerAwsBindRoutes(routes: Hono<{ Variables: TeamAuthVariables }>): void {
  routes.get('/', async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const doc = await teamByosBindings().findOne({ _id: teamId }, { projection: { awsRoles: 1 } })

    return c.json({
      accounts: await awsAccountsView(doc?.awsRoles, c.get('userId'), c.get('teamRole')),
    })
  })

  routes.post('/', requireTeamRole('ADMINISTRATOR'), zv('json', awsConnectorSchema), async (c) => {
    const { roleArn } = c.req.valid('json')
    const accountId = extractAwsAccountId(roleArn)!
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const existing = await findAwsBindingByRoleArn(teamId, roleArn)

    if (existing) {
      throw new AppError(409, 'role_already_bound', `AWS role ${roleArn} is already bound`)
    }
    // After the duplicate check (re-binding a known role adds no environment)
    // but before the credential round trips: a workspace at its plan's limit
    // shouldn't finish a bind it can't keep.

    // Reject the bind if the connector can't assume the role yet — better a
    // clear error here than a dead binding that fails on first use.
    await verifyRoleAssumable(teamId, roleArn)

    // Bindings must be unique across teams: credential minting reverse-
    // looks-up the team from the role ARN (findAwsOidcTeamForRoleArn), so two
    // teams sharing one OIDC-bound ARN would make that lookup ambiguous. A
    // concurrent-bind race can slip past this check, but the loser's binding
    // is inert — its tokens are rejected by the role's `sub` trust condition.
    const oidcOwner = await findAwsOidcTeamForRoleArn(roleArn)

    if (oidcOwner && !oidcOwner.equals(teamId)) {
      throw new AppError(
        409,
        'role_bound_elsewhere',
        `AWS role ${roleArn} is already bound via OIDC by another team`,
      )
    }

    const id = new ObjectId()
    const createdAt = new Date()
    const access = createDefaultAccess(c.get('userId'), createdAt)

    const inserted = await appendEnvironmentBinding(
      teamId,
      { 'awsRoles.roleArn': { $ne: roleArn } },
      {
        $push: {
          awsRoles: {
            id,
            roleArn,
            createdAt,
            access,
          },
        },
        $set: { updatedAt: createdAt },
      },
    )

    if (!inserted) {
      throw new AppError(409, 'role_already_bound', `AWS role ${roleArn} is already bound`)
    }

    return c.json(
      {
        roleId: id.toHexString(),
        accountId,
        roleArn,
        createdAt,
      },
      201,
    )
  })
}
