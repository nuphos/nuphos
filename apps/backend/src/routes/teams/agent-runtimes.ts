import { upgradeWebSocket } from 'hono/bun'
import { z } from 'zod'

import { parseLocalRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { boxUpdateStatus } from '@/lib/claude-code-preview/box-update'
import { localRuntimeStatus } from '@/lib/claude-code-preview/local-runtime-catalog'
import { isAllowedRemoteOpenAbUrl } from '@/lib/claude-code-preview/runtime-backend-url'
import {
  listRuntimeInstances,
  requireRuntimeInstance,
  withRuntimeReadiness,
} from '@/lib/claude-code-preview/runtime-catalog'
import { requestRuntimeDeletion } from '@/lib/claude-code-preview/runtime-deletion'
import { createManagedRuntimeInstance } from '@/lib/claude-code-preview/runtime-instances'
import {
  deviceMetricsRuntimeId,
  listRuntimeMetricSamples,
} from '@/lib/claude-code-preview/runtime-metrics-store'
import { runtimeModelCatalog } from '@/lib/claude-code-preview/runtime-models'
import { assertRuntimeNotDeleting } from '@/lib/claude-code-preview/runtime-portability-store'
import { defaultRuntimeLabel, OPENAB_PROVIDERS } from '@/lib/claude-code-preview/runtime-provider'
import { probeExternalRuntimeProvider } from '@/lib/claude-code-preview/runtime-provider-probe'
import {
  removeTeamRuntime,
  renameTeamRuntime,
  setTeamRuntimeStatus,
} from '@/lib/claude-code-preview/runtime-registry'
import { offeredSessionConfig } from '@/lib/claude-code-preview/session-config-catalog'
import { sessionConfigPickSchema } from '@/lib/claude-code-preview/session-config-options'
import {
  openRuntimeDesktop,
  runtimeDesktopEvents,
  runtimeDesktopTarget,
} from '@/lib/claude-code-preview/runtime-desktop'
import {
  runtimeTerminalTarget,
  runtimeTerminalEvents,
} from '@/lib/claude-code-preview/runtime-terminal'
import {
  requestRuntimeUpdate,
  runtimeStatusWithUpdate,
} from '@/lib/claude-code-preview/runtime-updates'
import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'

import { registerRuntimeFileRoutes } from './runtime-files'
import { registerRuntimeQuotaRoutes } from './runtime-quota'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { Context, Hono } from 'hono'

const label = z.string().trim().min(1).max(120)
const createSchema = z
  .object({
    label: label.optional(),
    provider: z.enum(OPENAB_PROVIDERS),
    // Ignored: agents no longer carry model defaults; accepted so older clients still save.
    defaults: z.unknown().optional(),
  })
  .strict()
const updateSchema = z
  .object({
    label: label.optional(),
    defaults: z.unknown().optional(),
    status: z.enum(['active', 'disabled']).optional(),
  })
  .strict()

export const probeSchema = z
  .object({
    url: z.string().trim().min(6).max(500),
    authKey: z.string().trim().min(1).max(500),
  })
  .strict()

export function registerAgentRuntimeRoutes(teamScoped: Hono<{ Variables: TeamAuthVariables }>) {
  registerRuntimeFileRoutes(teamScoped)
  teamScoped.get('/runtime-terminal/:sessionId', async (c) => {
    const target = await runtimeTerminalTarget(
      c.get('teamId'),
      c.get('userId'),
      c.req.param('sessionId'),
    )

    if (c.req.header('upgrade')?.toLowerCase() !== 'websocket')
      throw new AppError(426, 'upgrade_required', 'Connect with a WebSocket')

    return upgradeWebSocket(
      c as unknown as Context,
      runtimeTerminalEvents(target, { cols: c.req.query('cols'), rows: c.req.query('rows') }),
    )
  })

  teamScoped.post('/runtime-desktop/:sessionId', async (c) =>
    c.json(await openRuntimeDesktop(c.get('teamId'), c.get('userId'), c.req.param('sessionId'))),
  )

  teamScoped.get('/runtime-desktop/:sessionId/:display', async (c) => {
    const target = await runtimeDesktopTarget(
      c.get('teamId'),
      c.get('userId'),
      c.req.param('sessionId'),
      c.req.param('display'),
    )

    if (c.req.header('upgrade')?.toLowerCase() !== 'websocket')
      throw new AppError(426, 'upgrade_required', 'Connect with a WebSocket')

    return upgradeWebSocket(c as unknown as Context, runtimeDesktopEvents(target))
  })

  teamScoped.get('/agent-runtimes', async (c) => {
    const teamId = c.get('teamId')

    return c.json({
      runtimes: await withRuntimeReadiness(
        teamId,
        await listRuntimeInstances(teamId, c.get('userId')),
      ),
    })
  })
  teamScoped.get(
    '/agent-runtimes/:runtimeId/models',
    zv('query', z.object({ model: z.string().trim().min(1).max(500).optional() })),
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
  // A conversation that has not started yet picks from the runtime's own choices.
  teamScoped.get(
    '/agent-runtimes/:runtimeId/model-config',
    zv('query', sessionConfigPickSchema),
    async (c) => {
      const { options } = await offeredSessionConfig(
        (model) =>
          runtimeModelCatalog(c.get('teamId'), c.req.param('runtimeId'), model, c.get('userId')),
        c.req.valid('query'),
      )

      return c.json({ status: 'dormant', options })
    },
  )
  teamScoped.get(
    '/agent-runtimes/:runtimeId/metrics',
    zv('query', z.object({ hours: z.coerce.number().int().min(1).max(168).default(1) })),
    async (c) => {
      // With the actor, so a Box's agents are found as well.
      const instance = await requireRuntimeInstance(
        c.get('teamId'),
        c.req.param('runtimeId'),
        c.get('userId'),
      )
      const local = instance.kind === 'local' ? parseLocalRuntimeId(instance.id) : undefined
      const { hours } = c.req.valid('query')

      return c.json({
        // A local agent shows the computer it runs on; every agent there shares one series.
        samples: await listRuntimeMetricSamples(
          local ? deviceMetricsRuntimeId(local.userId, local.deviceId) : instance.id,
          Date.now() - hours * 3_600_000,
        ),
      })
    },
  )
  registerRuntimeQuotaRoutes(teamScoped)
  teamScoped.get('/agent-runtimes/:runtimeId/status', async (c) => {
    // A teammate's shared computer reports its status too, or its agent reads as offline.
    const instance = await requireRuntimeInstance(
      c.get('teamId'),
      c.req.param('runtimeId'),
      c.get('userId'),
      { shared: true },
    )

    if (instance.kind === 'local') {
      const runtimeUpdate = await boxUpdateStatus(instance.id)

      return c.json({
        ...(await localRuntimeStatus(instance.id)),
        ...(runtimeUpdate ? { runtimeUpdate } : {}),
      })
    }

    return c.json(await runtimeStatusWithUpdate(c.get('teamId'), c.get('userId'), instance))
  })
  teamScoped.post(
    '/agent-runtimes/:runtimeId/update',
    requireTeamRole('ADMINISTRATOR'),
    async (c) => {
      // With the actor, so a Box's agents (local runtimes) are found as well.
      const instance = await requireRuntimeInstance(
        c.get('teamId'),
        c.req.param('runtimeId'),
        c.get('userId'),
      )

      return c.json(await requestRuntimeUpdate(c.get('teamId'), instance, c.get('userId')), 202)
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

      return c.json(instance, 201)
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

    return c.body(null, 204)
  })
}
