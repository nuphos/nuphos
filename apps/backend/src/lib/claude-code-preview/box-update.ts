// A Box's agents update the way a managed agent's do, from its runtime card: the
// host reports the CLI it runs, and Update installs the newest one on the machine
// (BOX_UPDATE_COMMAND). Restarting the host ends every session on it, so the update
// is refused while one of its agents is mid-turn. Nothing is stored: the version
// the host reports is the state.

import { resumeBox } from '@/lib/agent/devices/box-instabox'
import { BOX_UPDATE_COMMAND } from '@/lib/agent/devices/box-instabox-client'
import { requireDeviceAccess } from '@/lib/agent/devices/box-access'
import { localRuntimeId, parseLocalRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { runtimePresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { getAgentDevice } from '@/lib/agent/devices/store'
import { AppError } from '@/lib/errors'

import { resolveLocalRuntimeEndpoint } from './local-runtime-catalog'
import { RUNTIME_RELEASES_URL, latestCliRelease, newerRuntimeVersion } from './runtime-release'
import { endpointHasActiveTurn } from './runtime-rollout'

import type { LocalAgentRef, LocalRuntimeRef } from '@/lib/agent/devices/local-runtime/address'
import type { LocalRuntimeStatus } from '@/lib/agent/devices/local-runtime/protocol'

export type BoxUpdateDeps = {
  isBox: (ref: LocalRuntimeRef) => Promise<boolean>
  /** Whether `actorId` may manage this Box in this team; only its team's administrators do. */
  canManage: (actorId: string, teamId: string, ref: LocalRuntimeRef) => Promise<boolean>
  status: (ref: LocalRuntimeRef) => Promise<LocalRuntimeStatus | undefined>
  latestVersion: () => Promise<{ version: string; url: string } | null>
  /** Whether that agent is mid-turn, asked as `actorId`; an agent that cannot be reached counts as idle. */
  busy: (teamId: string, runtimeId: string, actorId: string) => Promise<boolean>
  update: (ref: LocalRuntimeRef) => Promise<unknown>
}

const defaultDeps: BoxUpdateDeps = {
  isBox: async ({ userId, deviceId }) => Boolean((await getAgentDevice(userId, deviceId))?.box),
  canManage: async (actorId, teamId, { userId, deviceId }) => {
    const device = await requireDeviceAccess(actorId, teamId, deviceId, 'manage')

    return Boolean(device.box) && device.userId === userId
  },
  status: async ({ userId, deviceId }) =>
    (await runtimePresenceStore().get(userId, deviceId))?.status,
  latestVersion: latestCliRelease,
  busy: async (teamId, runtimeId, actorId) => {
    const endpoint = await resolveLocalRuntimeEndpoint(teamId, runtimeId, actorId, 'control').catch(
      () => null,
    )

    return endpoint ? endpointHasActiveTurn(endpoint) : false
  },
  update: ({ userId, deviceId }) => resumeBox(userId, deviceId, BOX_UPDATE_COMMAND),
}

async function box(runtimeId: string, deps: BoxUpdateDeps) {
  const ref = parseLocalRuntimeId(runtimeId)

  return ref && (await deps.isBox(ref)) ? { ref, status: await deps.status(ref) } : null
}

/** The update a Box agent's card shows; undefined for any other computer, or a Box that is away. */
export async function boxUpdateStatus(runtimeId: string, deps = defaultDeps) {
  const found = await box(runtimeId, deps)

  if (!found?.status) return undefined
  const currentVersion = found.status.cliVersion
  const release = await deps.latestVersion()
  let state: 'unknown' | 'current' | 'available' = 'unknown'

  if (currentVersion && release)
    state = newerRuntimeVersion(release.version, currentVersion) ? 'available' : 'current'

  return {
    state,
    currentVersion,
    latestVersion: release?.version,
    releaseUrl: release?.url ?? RUNTIME_RELEASES_URL,
  }
}

/** Every agent the host runs; one restart ends them all. */
function hostAgents({ userId, deviceId }: LocalRuntimeRef, status: LocalRuntimeStatus) {
  const agents: LocalAgentRef[] = [
    ...(Object.keys(status.agents) as LocalAgentRef['provider'][]).map((provider) => ({
      userId,
      deviceId,
      provider,
    })),
    ...(status.instances ?? []).map(({ provider, instanceId }) => ({
      userId,
      deviceId,
      provider,
      instanceId,
    })),
  ]

  return agents.map(localRuntimeId)
}

export async function requestBoxUpdate(
  teamId: string,
  runtimeId: string,
  actorId: string,
  deps = defaultDeps,
) {
  const found = await box(runtimeId, deps)

  if (!found) throw new AppError(409, 'runtime_not_managed', 'Update this agent on its host.')
  if (!(await deps.canManage(actorId, teamId, found.ref)))
    throw new AppError(404, 'device_not_found', 'Device is not available')
  if (!found.status)
    throw new AppError(409, 'runtime_offline', 'The Box is offline. Open it, then update.')
  const release = await deps.latestVersion()

  if (!release)
    throw new AppError(
      503,
      'runtime_release_unavailable',
      'Could not check the latest release. Try again shortly.',
    )
  for (const id of hostAgents(found.ref, found.status))
    if (await deps.busy(teamId, id, actorId))
      throw new AppError(409, 'runtime_busy', 'Updates wait for active conversations to finish.')
  await deps.update(found.ref)

  return { version: release.version }
}
