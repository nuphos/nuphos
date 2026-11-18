// A Box's agents update the way a managed agent's do, from its runtime card: the
// host reports the CLI it runs, and Update installs the newest one on the machine
// (BOX_UPDATE_COMMAND). Restarting the host ends every session on it, so the update
// is refused while one of its agents is mid-turn. The version the host reports is
// the state; the update notes only which version it installed (box-updating).
//
// Boxes also update on their own (runBoxAutoUpdates): an administrator clicking Update
// on every Box left most of them on the CLI they were created with (#2104).

import { requireDeviceAccess } from '@/lib/agent/devices/box-access'
import { resumeBox } from '@/lib/agent/devices/box-instabox'
import { BOX_UPDATE_COMMAND } from '@/lib/agent/devices/box-instabox-client'
import { listInstaboxBoxes, markBoxUpdateStarted } from '@/lib/agent/devices/box-updating'
import { lastLocalRuntimeTurnAt } from '@/lib/agent/devices/local-runtime/activity'
import { localRuntimeId, parseLocalRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { runtimePresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { getAgentDevice } from '@/lib/agent/devices/store'
import { AppError } from '@/lib/errors'
import { getTeamBoxAutoUpdate } from '@/lib/identity/box-auto-update'
import { logError, logEvent } from '@/lib/observability'
import { claimRun } from '@/lib/redis'

import { MINIMUM_HOST_VERSION } from './host-minimum-version'
import { resolveLocalRuntimeEndpoint } from './local-runtime-catalog'
import {
  RUNTIME_RELEASES_URL,
  latestCliRelease,
  newerRuntimeVersion,
  runtimeVersionAtLeast,
} from './runtime-release'
import { endpointHasActiveTurn } from './runtime-rollout'

import type { LocalAgentRef, LocalRuntimeRef } from '@/lib/agent/devices/local-runtime/address'
import type { LocalRuntimeStatus } from '@/lib/agent/devices/local-runtime/protocol'
import type { AgentDevice } from '@/lib/agent/devices/store'

export type BoxUpdateDeps = {
  isBox: (ref: LocalRuntimeRef) => Promise<boolean>
  /** Whether `actorId` may manage this Box in this team; only its team's administrators do. */
  canManage: (actorId: string, teamId: string, ref: LocalRuntimeRef) => Promise<boolean>
  status: (ref: LocalRuntimeRef) => Promise<LocalRuntimeStatus | undefined>
  latestVersion: () => Promise<{ version: string; url: string } | null>
  busy: typeof boxAgentBusy
  update: (ref: LocalRuntimeRef) => Promise<unknown>
  /** Notes the restart on the Box, so every viewer sees it updating rather than offline. */
  markUpdating: (ref: LocalRuntimeRef, version: string) => Promise<unknown>
}

/** Whether that agent is mid-turn, asked as `actorId`; an agent that cannot be reached counts as idle. */
export async function boxAgentBusy(teamId: string, runtimeId: string, actorId: string) {
  const endpoint = await resolveLocalRuntimeEndpoint(teamId, runtimeId, actorId, 'control').catch(
    () => null,
  )

  return endpoint ? endpointHasActiveTurn(endpoint) : false
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
  busy: boxAgentBusy,
  update: ({ userId, deviceId }) => resumeBox(userId, deviceId, BOX_UPDATE_COMMAND),
  markUpdating: ({ userId, deviceId }, version) => markBoxUpdateStarted(userId, deviceId, version),
}

async function box(runtimeId: string, deps: BoxUpdateDeps) {
  const ref = parseLocalRuntimeId(runtimeId)

  return ref && (await deps.isBox(ref)) ? { ref, status: await deps.status(ref) } : null
}

/** The update a Box agent's card shows; undefined for any other computer, or a Box that is away. */
export async function boxUpdateStatus(runtimeId: string, deps = defaultDeps) {
  const found = await box(runtimeId, deps)

  if (!found?.status) return
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
export function hostAgents({ userId, deviceId }: LocalRuntimeRef, status: LocalRuntimeStatus) {
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
    throw new AppError(409, 'runtime_offline', 'The computer is offline. Open it, then update.')
  const release = await deps.latestVersion()

  if (!release)
    throw new AppError(
      503,
      'runtime_release_unavailable',
      'Could not check the latest release. Try again shortly.',
    )
  if (await anyBusy(teamId, found.ref, found.status, actorId, deps))
    throw new AppError(409, 'runtime_busy', 'Updates wait for active conversations to finish.')
  await startUpdate(found.ref, release.version, deps)

  return { version: release.version }
}

async function anyBusy(
  teamId: string,
  ref: LocalRuntimeRef,
  status: LocalRuntimeStatus,
  actorId: string,
  deps: BoxUpdateDeps,
) {
  for (const id of hostAgents(ref, status)) if (await deps.busy(teamId, id, actorId)) return true

  return false
}

async function startUpdate(ref: LocalRuntimeRef, version: string, deps: BoxUpdateDeps) {
  await deps.update(ref)
  // After the command started: an update that could not start leaves the Box as it was. One
  // that started is reported as started even when the note fails; its card then reads offline.
  await deps.markUpdating(ref, version).catch((error: unknown) => {
    logError('agent.box.update_mark_failed', error, {
      user_id: ref.userId,
      device_id: ref.deviceId,
    })
  })
}

/** How often Boxes are checked, and how long a Box's agents must have been quiet to update. */
export const BOX_AUTO_UPDATE_INTERVAL_MS = 15 * 60_000
export const BOX_AUTO_UPDATE_IDLE_MS = 10 * 60_000

export type BoxAutoUpdateDeps = BoxUpdateDeps & {
  boxes: () => Promise<AgentDevice[]>
  /** Whether the team lets its Boxes update on their own; on unless it turned that off. */
  enabled: (teamId: string) => Promise<boolean>
  lastTurnAt: (ref: LocalRuntimeRef) => Promise<Date | undefined>
}

const defaultAutoDeps: BoxAutoUpdateDeps = {
  ...defaultDeps,
  boxes: listInstaboxBoxes,
  enabled: getTeamBoxAutoUpdate,
  lastTurnAt: ({ userId, deviceId }) => lastLocalRuntimeTurnAt(userId, deviceId),
}

/**
 * Updates every Box that runs an older CLI than the newest release, the way Update does,
 * once its agents have been quiet for a while: none mid-turn, none served a turn in the last
 * BOX_AUTO_UPDATE_IDLE_MS. A team can turn this off, except for a Box below the oldest CLI a
 * conversation runs on. A version an update already went to, and the Box came back without,
 * is not tried again on its own. Returns the Boxes it updated.
 */
export async function runBoxAutoUpdates(deps = defaultAutoDeps, now = Date.now()) {
  const release = await deps.latestVersion()
  const updated: string[] = []

  if (!release) return updated
  for (const device of await deps.boxes()) {
    const ref = { userId: device.userId, deviceId: device.deviceId }
    const { box } = device
    const status = await deps.status(ref)
    const current = status?.cliVersion

    // Away, a host that names no version, or already current.
    if (!box || !status || !current || !newerRuntimeVersion(release.version, current)) continue
    if (box.updateVersion === release.version) continue
    if (
      runtimeVersionAtLeast(current, MINIMUM_HOST_VERSION.cli) &&
      !(await deps.enabled(box.teamId))
    )
      continue
    const lastTurn = await deps.lastTurnAt(ref)

    if (lastTurn && now - lastTurn.getTime() < BOX_AUTO_UPDATE_IDLE_MS) continue
    if (await anyBusy(box.teamId, ref, status, box.createdBy ?? device.userId, deps)) continue
    try {
      await startUpdate(ref, release.version, deps)
      updated.push(device.deviceId)
      logEvent('info', 'agent.box.auto_update_started', {
        device_id: device.deviceId,
        team_id: box.teamId,
        from_version: current,
        to_version: release.version,
      })
    } catch (error) {
      logError('agent.box.auto_update_failed', error, { device_id: device.deviceId })
    }
  }

  return updated
}

/** Runs runBoxAutoUpdates on one replica every BOX_AUTO_UPDATE_INTERVAL_MS. */
export function startBoxAutoUpdate() {
  const sweep = async () => {
    if (!(await claimRun('agent:box:auto-update', BOX_AUTO_UPDATE_INTERVAL_MS - 60_000))) return
    await runBoxAutoUpdates().catch((error: unknown) => {
      logError('agent.box.auto_update_sweep_failed', error)
    })
  }
  const timer = setInterval(() => void sweep(), BOX_AUTO_UPDATE_INTERVAL_MS)

  timer.unref()

  return () => {
    clearInterval(timer)
  }
}
