import { registryKey, reportedAgents, withReport } from '@/lib/agent/devices/agent-registry'
import {
  deviceAccessDeps,
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
import type { TeamRuntimeEndpoint } from './team-openab-runtime'
import type { RegisteredAgent } from '@/lib/agent/devices/agent-registry'
import type { DeviceAccessDeps } from '@/lib/agent/devices/box-access'
import type { LocalAgentRef } from '@/lib/agent/devices/local-runtime/address'
import type { LocalRuntimePresence } from '@/lib/agent/devices/local-runtime/presence'
import type {
  LocalAgentProvider,
  LocalAgentStatus,
  LocalRuntimeStatus,
} from '@/lib/agent/devices/local-runtime/protocol'
import type { AgentDeviceBox } from '@/lib/agent/devices/store'

export type LocalRuntimeSummary = {
  ownerUserId: string
  deviceId: string
  deviceLabel: string
  /** The agent's own name; absent while it has its provider's. */
  agentLabel?: string
  instanceId?: string
  /** The team member who added this agent through Nuphos; absent for older and default agents. */
  addedBy?: { userId: string; at: string }
  agentInstances?: boolean
  /** Whether the computer reports this agent right now. */
  online: boolean
  /** Whether the owner's own CLI is signed in; null when the computer cannot tell. */
  signedIn: boolean | null
  /** Provider usage the computer reported, raw; normalized in runtime-quota. */
  usage?: unknown
  /** When that computer read the usage above. */
  usageAt?: string
  /** Present when the computer is a Box Nuphos made, rather than someone's own machine. */
  box?: Pick<AgentDeviceBox, 'provider'>
}

export type LocalRuntimeInstance = {
  id: string
  provider: LocalAgentProvider
  label: string
  status: 'active'
  kind: 'local'
  createdAt: string
  local: LocalRuntimeSummary
}

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

/** The user's own computers whose local agent is connected right now, in a team they belong to. */
export async function listOwnLocalRuntimes(
  teamId: string,
  userId: string,
  deps: LocalRuntimeCatalogDeps = defaultDeps,
): Promise<LocalRuntimeInstance[]> {
  if (!(await deps.isMember(userId, teamId))) return []
  const devices = await listAccessibleDevices(userId, teamId, deps.access)
  const listed = await Promise.all(
    devices.map(async (device): Promise<LocalRuntimeInstance[]> => {
      const presence = await deps.getPresence(device.userId, device.deviceId)
      // Every agent this computer ever had signed in, plus whatever it reports now (an
      // added agent appears once signed in; until then only its sign-in reaches it).
      const known = new Map<string, RegisteredAgent>()

      for (const agent of [...(device.agents ?? []), ...reportedAgents(presence?.status)])
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

          return {
            id,
            provider,
            label: `${label ?? runtimeLabel(provider)} in ${device.label}`,
            status: 'active',
            kind: 'local',
            createdAt: device.createdAt.toISOString(),
            local: {
              ownerUserId: device.userId,
              deviceId: device.deviceId,
              deviceLabel: device.label,
              ...(label ? { agentLabel: label } : {}),
              agentInstances: presence?.status?.agentInstances === true,
              ...(device.box ? { box: { provider: device.box.provider } } : {}),
              ...(instanceId ? { instanceId } : {}),
              ...(added ? { addedBy: { userId: added.userId, at: added.at.toISOString() } } : {}),
              // Reachable right now; offline, the last report still says who is signed in.
              online: reported !== undefined,
              signedIn: reported ? reported.cli.loggedIn : agent.signedIn,
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
 * Checked on every turn and control call: only the computer's owner may run it,
 * and only in a team they still belong to.
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
    // Anyone a Box is shared with may sign in its agents, as they may add them.
    const device = await requireDeviceAccess(userId, teamId, ref.deviceId, 'use', deps.access)

    if (device.userId !== ref.userId) throw notAvailable()
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
  }
}
