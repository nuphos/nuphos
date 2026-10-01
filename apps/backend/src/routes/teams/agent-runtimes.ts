import { z } from 'zod'

import { isLocalRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { localRuntimeStatus } from '@/lib/claude-code-preview/local-runtime-catalog'
import { isAllowedRemoteOpenAbUrl } from '@/lib/claude-code-preview/runtime-backend-url'
import {
  listRuntimeInstances,
  requireRuntimeInstance,
} from '@/lib/claude-code-preview/runtime-catalog'
import {
  runtimeDefaultsSchema,
  setRuntimeDefaults,
  removeRuntimeDefaults,
} from '@/lib/claude-code-preview/runtime-defaults'
import { requestRuntimeDeletion } from '@/lib/claude-code-preview/runtime-deletion'
import { createManagedRuntimeInstance } from '@/lib/claude-code-preview/runtime-instances'
import { listRuntimeMetricSamples } from '@/lib/claude-code-preview/runtime-metrics-store'
import { runtimeModelCatalog } from '@/lib/claude-code-preview/runtime-models'
import { assertRuntimeNotDeleting } from '@/lib/claude-code-preview/runtime-portability-store'
import { defaultRuntimeLabel } from '@/lib/claude-code-preview/runtime-provider'
import { probeExternalRuntimeProvider } from '@/lib/claude-code-preview/runtime-provider-probe'
import { fetchRuntimeQuota } from '@/lib/claude-code-preview/runtime-quota'
import {
  removeTeamRuntime,
  renameTeamRuntime,
  setTeamRuntimeStatus,
} from '@/lib/claude-code-preview/runtime-registry'
import { claudeCodePreviewRuntimeStatus } from '@/lib/claude-code-preview/runtime-status'
import {
  requestRuntimeUpdate,
  runtimeUpdateStatus,
} from '@/lib/claude-code-preview/runtime-updates'
import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

const label = z.string().trim().min(1).max(120)
const createSchema = z
  .object({
    label: label.optional(),
    provider: z.enum(['claude-code', 'codex']),
    defaults: runtimeDefaultsSchema.optional(),
  })
  .strict()
const updateSchema = z
  .object({
    label: label.optional(),
    defaults: runtimeDefaultsSchema.optional(),
    status: z.enum(['active', 'disabled']).optional(),
  })
  .strict()

export const probeSchema = z
  .object({
    url: z.string().trim().min(6).max(500),
    authKey: z.string().trim().min(1).max(500),
  })
  .strict()

/** Provider usage for every agent in the team, each read by the agent that
 *  holds its own credential. */
function registerRuntimeQuotaRoute(teamScoped: Hono<{ Variables: TeamAuthVariables }>) {
  teamScoped.get('/agent-runtimes/quota', async (c) => {
    const teamId = c.get('teamId')
    const instances = await listRuntimeInstances(teamId)

    return c.json({
      quotas: await Promise.all(instances.map((instance) => fetchRuntimeQuota(teamId, instance))),
    })
  })
}

export function registerAgentRuntimeRoutes(teamScoped: Hono<{ Variables: TeamAuthVariables }>) {
  teamScoped.get('/agent-runtimes', async (c) =>
    c.json({ runtimes: await listRuntimeInstances(c.get('teamId'), c.get('userId')) }),
  )
  teamScoped.get(
    '/agent-runtimes/:runtimeId/models',
    zv('query', z.object({ model: z.string().trim().min(1).max(500).optional() })),
    async (c, next) => {
      if (isLocalRuntimeId(c.req.param('runtimeId'))) await next()
      else await requireTeamRole('ADMINISTRATOR')(c, next)
    },
    async (c) =>
      c.json(
        await runtimeModelCatalog(
          c.get('teamId'),
          c.req.param('runtimeId'),
          c.req.valid('query').model,
          c.get('userId'),
        ),
      ),
  )
  teamScoped.get(
    '/agent-runtimes/:runtimeId/metrics',
    zv('query', z.object({ hours: z.coerce.number().int().min(1).max(168).default(1) })),
    async (c) => {
      const teamId = c.get('teamId')
      const instance = await requireRuntimeInstance(teamId, c.req.param('runtimeId'))
      const { hours } = c.req.valid('query')

      return c.json({
        samples: await listRuntimeMetricSamples(
          teamId,
          instance.id,
          Date.now() - hours * 3_600_000,
        ),
      })
    },
  )
  registerRuntimeQuotaRoute(teamScoped)
  teamScoped.get('/agent-runtimes/:runtimeId/status', async (c) => {
    const instance = await requireRuntimeInstance(
      c.get('teamId'),
      c.req.param('runtimeId'),
      c.get('userId'),
    )

    if (instance.kind === 'local') return c.json(await localRuntimeStatus(instance.id))

    const status = await claudeCodePreviewRuntimeStatus(
      c.get('teamId'),
      c.get('userId'),
      instance.provider,
      instance.id,
    )

    return c.json({
      ...status,
      runtimeUpdate: await runtimeUpdateStatus(c.get('teamId'), instance, status.runtimeVersion),
    })
  })
  teamScoped.post(
    '/agent-runtimes/:runtimeId/update',
    requireTeamRole('ADMINISTRATOR'),
    async (c) => {
      const instance = await requireRuntimeInstance(c.get('teamId'), c.req.param('runtimeId'))

      return c.json(await requestRuntimeUpdate(c.get('teamId'), instance), 202)
    },
  )

  // Lets the self-hosted connect form detect an unregistered runtime's agent
  // before submitting, instead of asking the operator to pick it. Persists
  // nothing; a failed or inconclusive probe just leaves `provider: null` for
  // the form to fall back to asking.
  teamScoped.post(
    '/agent-runtimes/probe-provider',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', probeSchema),
    async (c) => {
      const { url, authKey } = c.req.valid('json')

      if (!isAllowedRemoteOpenAbUrl(url))
        throw new AppError(
          422,
          'invalid_runtime_url',
          'Runtime URL must be wss://, or ws:// on a *.svc cluster-internal host.',
        )

      return c.json({ provider: (await probeExternalRuntimeProvider(url, authKey)) ?? null })
    },
  )
  teamScoped.post(
    '/agent-runtimes',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', createSchema),
    async (c) => {
      const input = c.req.valid('json')
      const teamId = c.get('teamId')
      const instance = await createManagedRuntimeInstance({
        ...input,
        label:
          input.label ??
          defaultRuntimeLabel(
            input.provider,
            (await listRuntimeInstances(teamId)).map((existing) => existing.label),
          ),
        teamId,
        userId: c.get('userId'),
      })

      if (input.defaults !== undefined)
        await setRuntimeDefaults(teamId, instance.id, input.defaults)

      return c.json({ ...instance, defaults: input.defaults ?? {} }, 201)
    },
  )
  teamScoped.patch(
    '/agent-runtimes/:runtimeId',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', updateSchema),
    async (c) => {
      const teamId = c.get('teamId')
      const instance = await requireRuntimeInstance(teamId, c.req.param('runtimeId'))
      const patch = c.req.valid('json')

      await assertRuntimeNotDeleting(teamId, instance.id)
      if (
        instance.kind === 'development' &&
        (patch.label !== undefined || patch.status !== undefined)
      )
        throw new AppError(
          400,
          'invalid_request',
          'Manage this agent in the local development configuration',
        )
      if (instance.kind === 'managed' || instance.kind === 'external') {
        if (patch.label !== undefined) await renameTeamRuntime(teamId, instance.id, patch.label)
        if (patch.status !== undefined)
          await setTeamRuntimeStatus(teamId, instance.id, patch.status)
      }

      if (patch.defaults !== undefined)
        await setRuntimeDefaults(teamId, instance.id, patch.defaults)

      return c.json(await requireRuntimeInstance(teamId, instance.id))
    },
  )
  teamScoped.delete('/agent-runtimes/:runtimeId', requireTeamRole('ADMINISTRATOR'), async (c) => {
    const teamId = c.get('teamId')
    const instance = await requireRuntimeInstance(teamId, c.req.param('runtimeId'))

    if (instance.kind === 'development')
      throw new AppError(
        400,
        'invalid_request',
        'Manage this agent in the local development configuration',
      )
    if (instance.kind === 'managed') {
      await requestRuntimeDeletion(teamId, instance, c.get('userId'))

      return c.json({ status: 'deleting' }, 202)
    }
    await removeTeamRuntime(teamId, instance.id)

    await removeRuntimeDefaults(teamId, instance.id)

    return c.body(null, 204)
  })
}
