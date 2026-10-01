import { ObjectId } from 'mongodb'

import { accessView, canUseAllowList, createDefaultAccess } from '@/lib/byos/access'
import { listGcpBindingsForProject } from '@/lib/byos/account'
import { gcpConnectorSchema } from '@/lib/byos/connector-schemas'
import { appendEnvironmentBinding } from '@/lib/byos/environment-bindings'
import { verifyGcpWifImpersonation } from '@/lib/byos/gcp-iam-http'
import { gcpWifConfigured, gcpWifPrincipalForTeam } from '@/lib/byos/gcp-wif'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { teamByosBindings } from '@/models'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { GcpServiceAccountBinding } from '@/models'
import type { Hono } from 'hono'

/**
 * The IAM principal the customer grants Service Account Token Creator to — the
 * one Nuphos-side value the onboarding wizard asks them to paste. Team-scoped
 * and non-secret: it names our pool and this team's subject, and confers nothing
 * without a grant on the customer's own service account.
 *
 * `configured: false` means this deploy cannot bind GCP accounts.
 */
function gcpWifInfo(teamId: string): {
  configured: boolean
  principal: string | null
} {
  return {
    configured: gcpWifConfigured(),
    principal: gcpWifConfigured() ? gcpWifPrincipalForTeam(teamId) : null,
  }
}

// Shared by the list GET below and the aggregated /connectors endpoint.
export async function gcpProjectsView(
  bindings: GcpServiceAccountBinding[] | undefined,
  userId: string,
  teamRole: string,
  _teamId: string,
) {
  const isAdmin = teamRole === 'ADMINISTRATOR'
  const all = bindings ?? []
  const visibleBindings = isAdmin
    ? all
    : all.filter((b) => canUseAllowList(b.access?.memberAllowList, userId))

  return await Promise.all(
    visibleBindings.map(async (b) => ({
      serviceAccountId: b.id.toHexString(),
      projectId: b.projectId,
      serviceAccountEmail: b.serviceAccountEmail,
      // The ACL (allow list + updatedAt/updatedBy) is admin-only metadata —
      // /access is admin-gated, so don't leak it to members in the list.
      ...(isAdmin ? { access: accessView(b.access) } : {}),
      canUse: canUseAllowList(b.access?.memberAllowList, userId),
      createdAt: b.createdAt,
      purpose: b.purpose ?? null,
      warnings: [],
    })),
  )
}

export function registerGcpBindingRoutes(
  gcpProjectsRoutes: Hono<{ Variables: TeamAuthVariables }>,
): void {
  gcpProjectsRoutes.get('/wif-info', (c) => {
    return c.json(gcpWifInfo(c.get('teamId')))
  })

  gcpProjectsRoutes.get('/', async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const doc = await teamByosBindings().findOne(
      { _id: teamId },
      { projection: { gcpServiceAccounts: 1 } },
    )

    return c.json({
      projects: await gcpProjectsView(
        doc?.gcpServiceAccounts,
        c.get('userId'),
        c.get('teamRole'),
        c.get('teamId'),
      ),
    })
  })

  gcpProjectsRoutes.post(
    '/',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', gcpConnectorSchema),
    async (c) => {
      const { serviceAccountEmail, projectId } = c.req.valid('json')
      const teamId = parseObjectId(c.get('teamId'), 'teamId')
      const existing = (await listGcpBindingsForProject(teamId, projectId)).find(
        (binding) => binding.serviceAccountEmail === serviceAccountEmail,
      )

      if (existing) {
        throw new AppError(
          409,
          'service_account_already_bound',
          `GCP service account ${serviceAccountEmail} is already bound to project ${projectId}`,
        )
      }
      // After the duplicate check (re-binding a known account adds no
      // environment) but before the credential round trips.

      // Reject a binding unless this team's WIF principal can already
      // impersonate it. GCP BYOS has no shared connector or key fallback.
      await verifyGcpWifImpersonation(serviceAccountEmail, c.get('teamId'))

      const warnings: string[] = []

      const id = new ObjectId()
      const createdAt = new Date()
      const access = createDefaultAccess(c.get('userId'), createdAt)

      const inserted = await appendEnvironmentBinding(
        teamId,
        {
          gcpServiceAccounts: {
            $not: { $elemMatch: { projectId, serviceAccountEmail } },
          },
        },
        {
          $push: {
            gcpServiceAccounts: {
              id,
              serviceAccountEmail,
              projectId,
              createdAt,
              access,
            },
          },
          $set: { updatedAt: createdAt },
        },
      )

      if (!inserted) {
        throw new AppError(
          409,
          'service_account_already_bound',
          `GCP service account ${serviceAccountEmail} is already bound to project ${projectId}`,
        )
      }

      return c.json(
        { serviceAccountId: id.toHexString(), projectId, serviceAccountEmail, createdAt, warnings },
        201,
      )
    },
  )
}
