import { api } from '../../../api'

import { pickLocalStarter, usableRuntime } from './starterSelection'

import type { StarterRuntime } from './starterSelection'
import type { AgentDevice } from '../../../api/device-types'
import type { AtlasTeam } from '../../../types'

const POLL_MS = 3_000
/** With no Box at all by then, none is coming. */
const NO_BOX_MS = 180_000
/** A Box still starting by then counts as failed too. */
const CAP_MS = 300_000

/** The free computer did not start; waiting longer will not help. */
export class ClaimFailure extends Error {}

/**
 * A signed-in Claude Code, Codex or Grok Build on this computer when there is
 * one, else OpenCode on the free computer, waited for in the background.
 */
export async function starterRuntime(
  teamId: string,
  cancelled: () => boolean,
): Promise<StarterRuntime> {
  const local = await localStarterRuntime(teamId).catch(() => null)

  if (local) return local

  return { runtimeId: await waitForOpenCode(teamId, cancelled), agentRuntime: 'opencode' }
}

async function localStarterRuntime(teamId: string): Promise<StarterRuntime | null> {
  const { detectionDisabled, deviceId } = await api.localRuntimeGetState()

  // Off in a development window on Nuphos Cloud, which never registers this computer there.
  if (detectionDisabled || !deviceId) return null

  return pickLocalStarter(await api.atlasListRuntimeInstances(teamId), deviceId)
}

/**
 * The workspace onboarding happens in: the first one this account owns, or
 * "My workspace" when it has none. Creating that team is what starts the free
 * computer; this never orders a Box itself.
 */
export async function resolveOwnTeam(
  createWorkspace: (name: string) => Promise<AtlasTeam>,
): Promise<string> {
  const owned = (await api.atlasListTeams()).find((team) => team.isOwner)

  return owned ? owned.id : (await createWorkspace('My workspace')).id
}

/**
 * Polls until OpenCode on the workspace's Box can be selected. A Box that
 * reports error fails at once, no Box after three minutes fails, and five
 * minutes fails whatever state the Box is in.
 */
export async function waitForOpenCode(teamId: string, cancelled: () => boolean): Promise<string> {
  const started = Date.now()

  while (!cancelled()) {
    const waited = Date.now() - started

    if (waited >= CAP_MS) throw new ClaimFailure()
    try {
      const match = await findOpenCode(teamId, waited)

      if (match) return match
    } catch (error) {
      if (error instanceof ClaimFailure || waited >= NO_BOX_MS) throw error
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }

  throw new DOMException('Cancelled', 'AbortError')
}

/** One look at the workspace's Boxes: OpenCode's runtime id, nothing yet, or ClaimFailure. */
async function findOpenCode(teamId: string, waited: number): Promise<string | undefined> {
  const boxes = (await api.boxListDevices({ teamId })).devices.filter((device) => device.box)
  const runtimes = boxes.length ? await api.atlasListRuntimeInstances(teamId) : []
  const openCode = (box: AgentDevice) =>
    box.box?.state === 'error'
      ? undefined
      : runtimes.find((instance) => usableRuntime(instance, box.deviceId, 'opencode'))
  // The free computer is "Computer 1". Wait on that one, so another computer's
  // runtime is not taken while it is still starting.
  const computer = boxes.find((box) => box.label === 'Computer 1')

  if (computer) {
    if (computer.box?.state === 'error') throw new ClaimFailure()

    return openCode(computer)?.id
  }
  const match = boxes.map(openCode).find(Boolean)

  if (match) return match.id
  if (!boxes.length && waited >= NO_BOX_MS) throw new ClaimFailure()
  if (boxes.length && boxes.every((box) => box.box?.state === 'error')) throw new ClaimFailure()

  return undefined
}
