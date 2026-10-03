import {
  localRuntimeId,
  localRuntimeUrl,
  parseLocalRuntimeId,
} from '@/lib/agent/devices/local-runtime/address'
import { runtimePresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { LOCAL_AGENT_PROVIDERS } from '@/lib/agent/devices/local-runtime/protocol'
import { isActiveTeamMember, listAgentDevicesForUser } from '@/lib/agent/devices/store'
import { AppError } from '@/lib/errors'

import { getLocalAgentDefaults } from './local-agent-defaults'

import type { RuntimeDefaults } from './runtime-defaults'
import type { RuntimeModelCatalog } from './runtime-models'
import type { PreviewRuntimeStatus } from './runtime-status'
import type { TeamRuntimeEndpoint } from './team-openab-runtime'
import type { LocalRuntimePresence } from '@/lib/agent/devices/local-runtime/presence'
import type { LocalAgentProvider } from '@/lib/agent/devices/local-runtime/protocol'
import type { AgentDevice } from '@/lib/agent/devices/store'

export type LocalRuntimeSummary = {
  ownerUserId: string
  deviceId: string
  deviceLabel: string
  /** Whether the owner's own CLI is signed in; null when the computer cannot tell. */
  signedIn: boolean | null
  /** Provider usage the computer reported, raw; normalized in runtime-quota. */
  usage?: unknown
  /** When that computer read the usage above. */
  usageAt?: string
}

export type LocalRuntimeInstance = {
  id: string
  provider: LocalAgentProvider
  label: string
  status: 'active'
  kind: 'local'
  createdAt: string
  local: LocalRuntimeSummary
  defaults: RuntimeDefaults
}

export type LocalRuntimeCatalogDeps = {
  listDevices: (userId: string) => Promise<AgentDevice[]>
  isMember: (userId: string, teamId: string) => Promise<boolean>
  getPresence: (userId: string, deviceId: string) => Promise<LocalRuntimePresence | null>
  getDefaults: (runtimeId: string) => Promise<RuntimeDefaults>
}

const defaultDeps: LocalRuntimeCatalogDeps = {
  listDevices: (userId) => listAgentDevicesForUser(userId),
  isMember: (userId, teamId) => isActiveTeamMember(userId, teamId),
  getPresence: (userId, deviceId) => runtimePresenceStore().get(userId, deviceId),
  getDefaults: (runtimeId) => getLocalAgentDefaults(runtimeId),
}

const PROVIDER_LABEL: Record<LocalAgentProvider, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
}

/** The user's own computers whose local agent is connected right now, in a team they belong to. */
export async function listOwnLocalRuntimes(
  teamId: string,
  userId: string,
  deps: LocalRuntimeCatalogDeps = defaultDeps,
): Promise<LocalRuntimeInstance[]> {
  if (!(await deps.isMember(userId, teamId))) return []
  const devices = await deps.listDevices(userId)
  const listed = await Promise.all(
    devices.map(async (device): Promise<LocalRuntimeInstance[]> => {
      const presence = await deps.getPresence(userId, device.deviceId)
      const running = LOCAL_AGENT_PROVIDERS.filter((p) => presence?.status?.agents[p])

      return Promise.all(
        running.map(async (provider): Promise<LocalRuntimeInstance> => {
          const id = localRuntimeId({ userId, deviceId: device.deviceId, provider })
          const reported = presence?.status?.agents[provider]

          return {
            id,
            provider,
            label: `${device.label} · ${PROVIDER_LABEL[provider]}`,
            status: 'active',
            kind: 'local',
            createdAt: device.createdAt.toISOString(),
            local: {
              ownerUserId: userId,
              deviceId: device.deviceId,
              deviceLabel: device.label,
              signedIn: reported?.cli.loggedIn ?? null,
              ...(reported?.usage !== undefined
                ? {
                    usage: reported.usage,
                    ...(reported.usageAt ? { usageAt: reported.usageAt } : {}),
                  }
                : {}),
            },
            defaults: await deps.getDefaults(id),
          }
        }),
      )
    }),
  )

  return listed.flat()
}

function notAvailable(): AppError {
  return new AppError(
    404,
    'runtime_not_found',
    'This agent is no longer available in this workspace. Move this conversation to another agent to continue.',
  )
}

/**
 * Checked on every turn and control call: only the computer's owner may run it,
 * and only in a team they still belong to.
 */
export async function resolveLocalRuntimeEndpoint(
  teamId: string,
  runtimeId: string,
  userId: string,
  purpose: 'transport' | 'control',
  deps: LocalRuntimeCatalogDeps = defaultDeps,
): Promise<TeamRuntimeEndpoint & { runtimeId: string }> {
  const ref = parseLocalRuntimeId(runtimeId)

  if (!ref || ref.userId !== userId) throw notAvailable()
  const [member, presence] = await Promise.all([
    deps.isMember(ref.userId, teamId),
    deps.getPresence(ref.userId, ref.deviceId),
  ])

  if (!member) throw notAvailable()
  const agent = presence?.status?.agents[ref.provider]

  if (!presence || !agent)
    throw new AppError(
      409,
      'runtime_offline',
      'The computer running this agent is offline. Open Nuphos on it with the local agent turned on.',
    )
  if (agent.cli.loggedIn === false)
    throw new AppError(
      409,
      'runtime_login_required',
      `Sign in to ${PROVIDER_LABEL[ref.provider]} on the computer running this agent before it can run conversations.`,
    )

  return {
    url: localRuntimeUrl(ref, teamId),
    authKey: purpose,
    runtimeId,
    external: true,
    local: { userId: ref.userId, deviceId: ref.deviceId },
    ...(ref.provider === 'codex' ? { provider: 'codex' as const } : {}),
    ...(presence.status?.backendUrl ? { backendUrl: presence.status.backendUrl } : {}),
  }
}

/** The computer reports its agent's models when it connects, so none need a conversation first. */
export async function localRuntimeModels(
  runtimeId: string,
  model: string | undefined,
  deps: Pick<LocalRuntimeCatalogDeps, 'getPresence'> = defaultDeps,
): Promise<RuntimeModelCatalog> {
  const ref = parseLocalRuntimeId(runtimeId)
  const catalog = ref
    ? (await deps.getPresence(ref.userId, ref.deviceId))?.status?.agents[ref.provider]?.models
    : undefined

  if (!catalog)
    return {
      models: [],
      message: 'The computer running this agent has not reported its models yet. Retry shortly.',
    }
  const modelId = model ?? catalog.defaultModel
  const controls = catalog.controls[modelId]

  return {
    models: catalog.models,
    ...(controls ? { controls: { modelId, ...controls } } : {}),
  }
}

/** A local runtime's status comes from its computer's tunnel, not a probe. */
export async function localRuntimeStatus(
  runtimeId: string,
  deps: Pick<LocalRuntimeCatalogDeps, 'getPresence'> = defaultDeps,
): Promise<PreviewRuntimeStatus> {
  const ref = parseLocalRuntimeId(runtimeId)
  const presence = ref ? await deps.getPresence(ref.userId, ref.deviceId) : null
  const agent = ref ? presence?.status?.agents[ref.provider] : undefined
  const online = agent !== undefined
  const signedIn = agent?.cli.loggedIn

  return {
    configured: true,
    selected: true,
    connected: online,
    online,
    attachedConversations: null,
    busyConversations: null,
    ...(agent?.version ? { runtimeAdapterVersion: agent.version } : {}),
    ...(typeof signedIn === 'boolean' ? { authenticated: signedIn } : {}),
  }
}
