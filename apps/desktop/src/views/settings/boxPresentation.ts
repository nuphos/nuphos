import type { RuntimeStatusView } from './runtimePresentation'
import type { AgentDevice, BoxState, BoxStatus } from '../../api/device-types'
import type { RuntimeInstance } from '../../types/runtime'

export type BoxDevice = AgentDevice & { box: BoxStatus }

// A Box being set up, or a cloud Box whose host is away, changes without the user acting.
export const BOX_CREATING_POLL_MS = 2_000
// A Box still creating after this long will not come up.
export const BOX_SETUP_TIMEOUT_MS = 5 * 60_000

/** A cloud Box's state, or, for a computer, `stopped` while its agents are not connected. */
export type MachineState = BoxState | 'stopped'

export const BOX_BADGE: Record<MachineState, RuntimeStatusView> = {
  creating: { label: 'Starting', tone: 'pending' },
  running: { label: 'Running', tone: 'online' },
  paused: { label: 'Paused', tone: 'off' },
  stopped: { label: 'Offline', tone: 'off' },
  error: { label: "Didn't start", tone: 'error' },
}

/** What can be done to a Box in each state; a starting Box needs nothing from you. */
export function boxActions(state: MachineState): {
  pause: boolean
  resume: boolean
  remove: boolean
} {
  return {
    pause: state === 'running',
    resume: state === 'paused' || state === 'error',
    remove: state !== 'creating',
  }
}

/** The user's cloud Boxes. */
export function boxes(devices: AgentDevice[]): BoxDevice[] {
  return devices.filter((device): device is BoxDevice => device.box !== undefined)
}

/** What the Boxes list shows: a computer while its agents are connected; a cloud Box always, so it can be resumed. */
export function machines(devices: AgentDevice[]): AgentDevice[] {
  return devices.filter((device) => device.box !== undefined || device.online === true)
}

/** Derived, never stored: a cloud Box's state is instabox's; a computer is running while connected. */
export function boxState(device: AgentDevice): MachineState {
  if (device.box) return device.box.state

  return device.online ? 'running' : 'stopped'
}

/**
 * How soon to look again: quickly around a sign-in, while a Box is starting or while a running
 * Box's host reconnects; otherwise 0, not at all (actions and a returning window reload the list).
 */
export function boxPollMs(devices: AgentDevice[], signingIn: boolean): number {
  if (signingIn) return 1_500

  return boxes(devices).some(
    (device) =>
      device.box.state === 'creating' || (device.box.state === 'running' && !device.online),
  )
    ? BOX_CREATING_POLL_MS
    : 0
}

const OS_LABEL: Record<string, string> = { darwin: 'macOS', linux: 'Linux', win32: 'Windows' }

/** "macOS · MacBook Pro", "Linux · instabox". */
export function machineLine(device: AgentDevice): string {
  const os = OS_LABEL[device.platform] ?? device.platform

  if (device.box) return `${os} · instabox`

  return device.model ? `${os} · ${device.model}` : os
}

/** Boxes that were creating and are gone: #355 drops a Box whose machine could not be made. */
export function vanishedBoxes(previous: AgentDevice[], next: AgentDevice[]): BoxDevice[] {
  const ids = new Set(next.map((device) => device.deviceId))

  return boxes(previous).filter(
    (device) => device.box.state === 'creating' && !ids.has(device.deviceId),
  )
}

/** The team's agents that run on this machine. */
export function boxAgents(deviceId: string, instances: RuntimeInstance[]): RuntimeInstance[] {
  return instances.filter(
    (instance) => instance.kind === 'local' && instance.local?.deviceId === deviceId,
  )
}

export type BoxSetupPhase = 'idle' | 'starting' | 'ready' | 'error' | 'timeout'

/** Where a Box made by a setup flow stands: up once the team lists one of its agents. */
export function boxSetupPhase(
  deviceId: string | null,
  devices: AgentDevice[] | null,
  agents: RuntimeInstance[],
  now = Date.now(),
): BoxSetupPhase {
  if (!deviceId) return 'idle'
  if (agents.length > 0) return 'ready'
  if (!devices) return 'starting'
  const device = boxes(devices).find((candidate) => candidate.deviceId === deviceId)

  if (!device || device.box.state === 'error') return 'error'
  const created = Date.parse(device.createdAt ?? '')

  return now - created > BOX_SETUP_TIMEOUT_MS ? 'timeout' : 'starting'
}

/** Why a setup flow's Box did not come up, or null while it still may. */
export function boxSetupProblem(phase: BoxSetupPhase): string | null {
  if (phase === 'error')
    return 'The Box could not start. Delete it in Settings › Agents and try again.'
  if (phase === 'timeout')
    return 'The Box has not started after 5 minutes. Delete it in Settings › Agents and try again.'

  return null
}
