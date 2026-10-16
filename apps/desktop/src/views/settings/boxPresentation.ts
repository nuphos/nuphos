import type { RuntimeStatusView } from './runtimePresentation'
import type {
  AgentDevice,
  BoxState,
  BoxStatus,
  BoxUsage,
  LocalAgentProvider,
} from '../../api/device-types'
import type { RuntimeInstance } from '../../types/runtime'

export type BoxDevice = AgentDevice & { box: BoxStatus }

// A Box being set up changes without the user acting.
export const BOX_CREATING_POLL_MS = 1_000
// Live metrics hold a lease on each connected machine; the visible page renews it.
export const BOX_METRICS_POLL_MS = 5_000
// A Box whose host is away comes back on its own only rarely; look now and then.
export const BOX_OFFLINE_POLL_MS = 30_000
// A Box still creating after this long will not come up.
export const BOX_SETUP_TIMEOUT_MS = 5 * 60_000
/**
 * A cloud Box's state, or, for a computer, `stopped` while its agents are not connected.
 * A Box is `creating` until instabox has its machine, `connecting` until its host first joins,
 * and `hostOffline` when a host that joined has dropped.
 */
export type MachineState = BoxState | 'stopped' | 'hostOffline'

export const BOX_BADGE: Record<MachineState, RuntimeStatusView> = {
  creating: { label: 'Starting', tone: 'pending' },
  connecting: { label: 'Connecting', tone: 'pending' },
  running: { label: 'Running', tone: 'online' },
  hostOffline: { label: 'Host offline', tone: 'pending' },
  paused: { label: 'Paused', tone: 'off' },
  stopped: { label: 'Offline', tone: 'off' },
  error: { label: "Didn't start", tone: 'error' },
}

/** A member who may only use a machine sees it, not the controls the backend would refuse. */
export function canManage(device: AgentDevice): boolean {
  return device.access !== 'use'
}

/** Shown when the backend gives no reason, e.g. an older backend without the route. */
const REMOVE_FALLBACK = 'Could not remove it. Update Nuphos and try again.'

/**
 * How a machine leaves the list: a Box is deleted, any time; a computer is only forgotten once
 * offline, since online it would register again.
 */
export function removal(device: AgentDevice) {
  if (device.box)
    return {
      allowed: true,
      action: 'Delete',
      confirm: 'Delete Box',
      error: 'Could not delete Box',
      fallback: REMOVE_FALLBACK,
      description:
        "This permanently deletes the Box, its files and its agents' sign-ins, and stops conversations running on it. Your conversation history stays in Nuphos.",
    }

  return {
    allowed: !device.online,
    action: 'Remove computer',
    confirm: 'Remove computer',
    error: 'Could not remove computer',
    fallback: REMOVE_FALLBACK,
    description:
      'This removes the computer and its agents from Nuphos. Opening Nuphos on it registers it again. Your conversation history stays in Nuphos.',
  }
}

/** What a Box's state allows besides Delete, which is always there. */
export function boxActions(state: MachineState): { pause: boolean; resume: boolean } {
  return {
    pause: state === 'running' || state === 'connecting' || state === 'hostOffline',
    // Resuming restarts the host, which brings back one that dropped.
    resume: state === 'paused' || state === 'error' || state === 'hostOffline',
  }
}

/** The user's cloud Boxes. */
export function boxes(devices: AgentDevice[]): BoxDevice[] {
  return devices.filter((device): device is BoxDevice => device.box !== undefined)
}

/** A Box being set up: its machine is being made, or its host has not joined yet. */
const setupStates = new Set<MachineState>(['creating', 'connecting'])

/** Derived, never stored: a cloud Box's state is instabox's; a computer is running while connected. */
export function boxState(device: AgentDevice, now = Date.now()): MachineState {
  if (!device.box) return device.online ? 'running' : 'stopped'
  const { state } = device.box

  // A Box still being set up long after it was made will not come up: it didn't start.
  if (setupStates.has(state))
    return now - Date.parse(device.createdAt ?? '') > BOX_SETUP_TIMEOUT_MS ? 'error' : state

  return state === 'running' && !device.online ? 'hostOffline' : state
}

/**
 * How soon to look again: quickly while a Box is being made or around a sign-in; every few
 * seconds while a connected machine shows live metrics; rarely while a host is away; otherwise
 * not at all (actions and a returning window reload the list).
 */
export function boxPollMs(devices: AgentDevice[], signingIn: boolean): number {
  const states = new Set(devices.map((device) => boxState(device)))

  if ([...states].some((state) => setupStates.has(state))) return BOX_CREATING_POLL_MS
  if (signingIn) return 1_500
  if (devices.some((device) => device.online)) return BOX_METRICS_POLL_MS

  return states.has('hostOffline') ? BOX_OFFLINE_POLL_MS : 0
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

/** What New Agent does for a provider: add an agent when the host can, else sign in the one it has. */
export function newAgentAction(
  agents: RuntimeInstance[],
  provider: LocalAgentProvider,
): { create: true } | { signIn: string } | null {
  if (agents.some((agent) => agent.local?.agentInstances === true)) return { create: true }
  const idle = agents.find((agent) => agent.provider === provider && agent.local?.signedIn !== true)

  return idle ? { signIn: idle.id } : null
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

/** The plans the billing service sells, smallest first; `vcpus` keys the billing service's nuphos_box_<vcpus>vcpu_monthly price. */
export const BOX_PLANS = [
  { name: 'Starter', vcpus: 4, usdPerMonth: 20 },
  { name: 'Pro', vcpus: 12, usdPerMonth: 50 },
  { name: 'Scale', vcpus: 24, usdPerMonth: 100 },
]

/** Why the team's vCPU limit keeps a new Box from starting; null when one can start. */
export function newBoxBlockedReason(usage: BoxUsage | null, isAdmin: boolean): string | null {
  if (usage?.limitVcpus === 0)
    return isAdmin
      ? 'Your team has no Box plan yet. Choose a plan to start a Box.'
      : 'Ask a team administrator to add a Box plan.'
  if (usage?.limitVcpus == null || usage.usedVcpus === null || usage.boxVcpus === null) return null
  if (usage.usedVcpus + usage.boxVcpus <= usage.limitVcpus) return null

  return `Your running Boxes use ${String(usage.usedVcpus)} of ${String(usage.limitVcpus)} vCPU, and a new Box needs ${String(usage.boxVcpus)}. Pause a Box or upgrade.`
}
