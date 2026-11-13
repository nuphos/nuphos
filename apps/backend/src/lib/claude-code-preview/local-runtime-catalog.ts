import {
  isPendingRemoval,
  registryKey,
  reportedAgents,
  withReport,
} from '@/lib/agent/devices/agent-registry'
import {
  deviceAccessDeps,
  deviceOwner,
  listAccessibleDevices,
  requireDeviceAccess,
} from '@/lib/agent/devices/box-access'
import {
  localRuntimeId,
  localRuntimeUrl,
  parseLocalRuntimeId,
} from '@/lib/agent/devices/local-runtime/address'
import { runtimePresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { LOCAL_AGENT_PROVIDERS } from '@/lib/agent/devices/local-runtime/protocol'
import { isActiveTeamMember } from '@/lib/agent/devices/store'
import { AppError } from '@/lib/errors'

import { runtimeLabel } from './runtime-provider'

import type { RuntimeModelCatalog } from './runtime-models'
import type { PreviewRuntimeStatus } from './runtime-status'
import type { LocalRuntimeInstance } from './local-runtime-summary'
import type { TeamRuntimeEndpoint } from './team-openab-runtime'
import type { RegisteredAgent } from '@/lib/agent/devices/agent-registry'
import type { DeviceAccessDeps } from '@/lib/agent/devices/box-access'
import type { LocalAgentRef } from '@/lib/agent/devices/local-runtime/address'
import type { LocalRuntimePresence } from '@/lib/agent/devices/local-runtime/presence'
import type {
  LocalAgentStatus,
  LocalRuntimeStatus,
} from '@/lib/agent/devices/local-runtime/protocol'

export type { LocalRuntimeInstance, LocalRuntimeSummary } from './local-runtime-summary'

export type LocalRuntimeCatalogDeps = {
  access: DeviceAccessDeps
  isMember: (userId: string, teamId: string) => Promise<boolean>
  getPresence: (userId: string, deviceId: string) => Promise<LocalRuntimePresence | null>
}

const defaultDeps: LocalRuntimeCatalogDeps = {
  access: deviceAccessDeps,
  isMember: (userId, teamId) => isActiveTeamMember(userId, teamId),
  getPresence: (userId, deviceId) => runtimePresenceStore().get(userId, deviceId),
}

/** Explicit instances never fall back to a provider's legacy default. */
export function reportedLocalAgent(
  status: LocalRuntimeStatus | undefined,
  ref: Pick<LocalAgentRef, 'provider' | 'instanceId'>,
): LocalAgentStatus | undefined {
  return ref.instanceId
    ? status?.instances?.find(
        (instance) => instance.instanceId === ref.instanceId && instance.provider === ref.provider,
      )
    : status?.agents[ref.provider]
}

/**
 * The agents this person may place a conversation on, in a team they belong to:
 * their own computers, the Boxes shared with them, and teammates' computers shared with them.
 */
export async function listOwnLocalRuntimes(
  teamId: string,
  userId: string,
  deps: LocalRuntimeCatalogDeps = defaultDeps,
): Promise<LocalRuntimeInstance[]> {
  if (!(await deps.isMember(userId, teamId))) return []
  const devices = await listAccessibleDevices(userId, teamId, deps.access)
  const listed = await Promise.all(
    devices.map(async (device): Promise<LocalRuntimeInstance[]> => {
      // A teammate's computer: the desktop's approval wait still reads its level.
      const shared = !device.box && deviceOwner(device) !== userId
      const presence = await deps.getPresence(device.userId, device.deviceId)
      // Every agent this computer ever had signed in, plus whatever it reports now (an
      // added agent appears once signed in; until then only its sign-in reaches it).
      const known = new Map<string, RegisteredAgent>()
      const registered = new Set((device.agents ?? []).map(registryKey))
      // One removed while the computer was offline stays gone until the computer deletes it.
      const seen = [...(device.agents ?? []), ...reportedAgents(presence?.status)].filter(
        (agent) => !isPendingRemoval(agent, device.removedAgents ?? []),
      )

      for (const agent of seen)
        known.set(registryKey(agent), withReport(known.get(registryKey(agent)), agent))
      const running = [...known.values()]

      return Promise.all(
        running.map(async (agent): Promise<LocalRuntimeInstance> => {
          const { provider, instanceId, label } = agent
          const id = localRuntimeId({
            userId: device.userId,
            deviceId: device.deviceId,
            provider,
            instanceId,
          })
          const reported = presence ? reportedLocalAgent(presence.status, agent) : undefined
          const added =
            instanceId && device.addedAgents?.find((entry) => entry.instanceId === instanceId)
          const signIn = device.signIns?.find((entry) => entry.key === registryKey(agent))

          return {
            id,
            provider,
            label: `${label ?? runtimeLabel(provider)} in ${device.label}`,
            status: 'active',
            kind: 'local',
            createdAt: device.createdAt.toISOString(),
            local: {
              ownerUserId: deviceOwner(device),
              deviceId: device.deviceId,
              deviceLabel: device.label,
              ...(label ? { agentLabel: label } : {}),
              agentInstances: presence?.status?.agentInstances === true,
              ...(presence?.status?.desktopOpen === true ? { desktopOpen: true as const } : {}),
              ...(device.box ? { box: { provider: device.box.provider } } : {}),
              ...(shared ? { shared: { level: 'full' as const } } : {}),
              ...(instanceId ? { instanceId } : {}),
              ...(added ? { addedBy: { userId: added.userId, at: added.at.toISOString() } } : {}),
              ...(signIn
                ? { signedInBy: { userId: signIn.userId, at: signIn.at.toISOString() } }
                : {}),
              // Reachable right now; offline, the last report still says who is signed in.
              online: reported !== undefined,
              signedIn: reported ? reported.cli.loggedIn : agent.signedIn,
              ...(registered.has(registryKey(agent)) ? { everSignedIn: true as const } : {}),
              ...(reported?.usage !== undefined
                ? {
                    usage: reported.usage,
                    ...(reported.usageAt ? { usageAt: reported.usageAt } : {}),
                  }
                : {}),
            },
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
 * Checked on every turn and control call: someone who may use the computer, in a
 * team they still belong to.
 */
export async function resolveLocalRuntimeEndpoint(
  teamId: string,
  runtimeId: string,
  userId: string,
  /** `login` is the control channel for the agent's own sign-in, so signed out is fine. */
  purpose: 'transport' | 'control' | 'login',
  deps: LocalRuntimeCatalogDeps = defaultDeps,
): Promise<TeamRuntimeEndpoint & { runtimeId: string }> {
  const ref = parseLocalRuntimeId(runtimeId)

  if (!ref || !(await deps.isMember(userId, teamId))) throw notAvailable()
  let deviceLabel: string

  try {
    // Anyone who may use the computer reaches its agents' sign-in; the route says who starts one.
    const device = await requireDeviceAccess(userId, teamId, ref.deviceId, 'use', deps.access)

    // One removed while its computer was offline is gone, not waiting for the computer.
    if (device.userId !== ref.userId || isPendingRemoval(ref, device.removedAgents ?? []))
      throw notAvailable()
    deviceLabel = device.label
  } catch (error) {
    if (error instanceof AppError && error.status === 404) throw notAvailable()
    throw error
  }
  // An offline Box is not woken here: the session queue waits for it (queued-turn.ts).
  const presence = await deps.getPresence(ref.userId, ref.deviceId)
  const agent = reportedLocalAgent(presence?.status, ref)

  // Signing in needs only the computer: an agent added a moment ago may not be in its last
  // report yet, and the host's own sign-in answers for it (the login retries while it starts).
  if (!presence || (!agent && purpose !== 'login'))
    throw new AppError(
      409,
      'runtime_offline',
      'The computer running this agent is offline. Open Nuphos on it with the local agent turned on.',
      // The placement just authorized: a send to an offline Box queues for it (queueForOfflineBox).
      { runtimeId, runtimeLabel: `${runtimeLabel(ref.provider)} in ${deviceLabel}` },
    )
  if (agent?.cli.loggedIn === false && purpose !== 'login')
    throw new AppError(
      409,
      'runtime_login_required',
      `Sign in to ${runtimeLabel(ref.provider)} on the computer running this agent before it can run conversations.`,
    )

  return {
    url: localRuntimeUrl(ref, teamId, userId),
    authKey: purpose === 'login' ? 'control' : purpose,
    runtimeId,
    external: true,
    local: { userId: ref.userId, deviceId: ref.deviceId },
    ...(ref.provider === 'claude-code' ? {} : { provider: ref.provider }),
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
    ? reportedLocalAgent((await deps.getPresence(ref.userId, ref.deviceId))?.status, ref)?.models
    : undefined

  if (!catalog)
    return {
      models: [],
      message: 'The computer running this agent has not reported its models yet. Retry shortly.',
    }
  const modelId = model && model !== 'default' ? model : catalog.defaultModel
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
  const agent = ref ? reportedLocalAgent(presence?.status, ref) : undefined
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
    ...(signedIn && agent?.cli.apiKey ? { apiKey: true as const } : {}),
  }
}
