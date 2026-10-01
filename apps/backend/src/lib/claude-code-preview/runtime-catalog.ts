import { config } from '@/config'
import { isLocalRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { AppError } from '@/lib/errors'

import { listOwnLocalRuntimes, resolveLocalRuntimeEndpoint } from './local-runtime-catalog'
import { listRuntimeDefaults } from './runtime-defaults'
import { managedRuntimeImage } from './runtime-image'
import { runtimeDeletions } from './runtime-portability-store'
import { runtimeLabel } from './runtime-provider'
import { listTeamRuntimes } from './runtime-registry'

import type { RuntimeInstance } from './runtime-instances'
import type { OpenAbProvider } from './runtime-provider'
import type { TeamRuntimeEndpoint } from './team-openab-runtime'

export function developmentRuntimeEndpoint(
  provider: OpenAbProvider,
  purpose: 'transport' | 'control' = 'transport',
): (TeamRuntimeEndpoint & { runtimeId: string }) | undefined {
  const endpoint =
    provider === 'codex'
      ? config.claudeCodePreview.codexDevelopmentRuntimeEndpoint
      : config.claudeCodePreview.developmentRuntimeEndpoint

  if (!endpoint) return undefined
  const authKey =
    purpose === 'control'
      ? provider === 'codex'
        ? config.claudeCodePreview.codexDevelopmentControlKey
        : config.claudeCodePreview.developmentControlKey
      : endpoint.authKey

  if (!authKey) throw new Error('Configure the development runtime operator credential')

  return { ...endpoint, authKey, provider, runtimeId: `development-${provider}` }
}

/** Local agents appear only for their owner; without a user, only the team's own agents. */
export async function listRuntimeInstances(
  teamId: string,
  userId?: string,
): Promise<RuntimeInstance[]> {
  const groups = await Promise.all(
    (['claude-code', 'codex'] as const).map(async (provider) => {
      // Every registered runtime owns its login and reports it through its status.
      const registered: RuntimeInstance[] = (await listTeamRuntimes(teamId, provider)).map(
        (runtime) => ({
          id: runtime.id,
          provider,
          label: runtime.label ?? `${runtimeLabel(provider)} · ${runtime.id.slice(0, 6)}`,
          status: runtime.status,
          ...(runtime.hostedBy
            ? {
                kind: 'managed' as const,
                image: managedRuntimeImage(provider, runtime.requestedRuntimeVersion),
              }
            : {
                kind: 'external' as const,
                ...(runtime.connection ? { connection: runtime.connection } : {}),
              }),
          createdAt: runtime.createdAt,
        }),
      )
      const development = developmentRuntimeEndpoint(provider)

      return [
        ...registered,
        ...(development
          ? [
              {
                id: development.runtimeId,
                provider,
                label: `${runtimeLabel(provider)} (local development)`,
                status: 'active' as const,
                kind: 'development' as const,
                createdAt: '',
              },
            ]
          : []),
      ]
    }),
  )

  const instances = [
    ...groups.flat(),
    ...(userId ? await listOwnLocalRuntimes(teamId, userId) : []),
  ]
  const defaults = await listRuntimeDefaults(
    teamId,
    instances.map((instance) => instance.id),
  )

  const deletions = await runtimeDeletions()
    .find({ teamId, completedAt: { $exists: false } })
    .sort({ requestedAt: 1 })
    .toArray()

  return instances.map((instance) => ({
    ...instance,
    ...(deletions.find((job) => job._id === instance.id)
      ? {
          status: 'disabled' as const,
          deletion: {
            state: 'deleting' as const,
            error: deletions.find((job) => job._id === instance.id)?.error,
          },
        }
      : {}),
    defaults: instance.kind === 'local' ? instance.defaults : (defaults.get(instance.id) ?? {}),
  }))
}

export async function requireRuntimeInstance(
  teamId: string,
  runtimeId: string,
  userId?: string,
): Promise<RuntimeInstance> {
  const instance = (await listRuntimeInstances(teamId, userId)).find(
    (candidate) => candidate.id === runtimeId,
  )

  if (!instance && userId && isLocalRuntimeId(runtimeId))
    await resolveLocalRuntimeEndpoint(teamId, runtimeId, userId, 'transport')
  if (!instance)
    throw new AppError(
      404,
      'runtime_not_found',
      'This agent is no longer available in this workspace. Move this conversation to another agent to continue.',
    )

  return instance
}
