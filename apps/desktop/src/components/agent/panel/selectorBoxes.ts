import { t } from '../../../i18n/index.ts'
import { listedAgents } from '../../../lib/agentName.ts'
import { quotaSignedOut } from '../../../lib/runtimeQuota.ts'
import { AGENT_PROVIDER } from '../../../types/runtime.ts'
import { computerOwner, ownerName } from '../../../views/settings/computerOwner.ts'

import type { AgentDevice } from '../../../api/device-types'
import type { RuntimeInstance, RuntimeQuota } from '../../../types/runtime'
import type { TeamMember } from '../../../types/team'

export type SelectorBox = {
  id: string
  label: string
  device?: AgentDevice
  agents: RuntimeInstance[]
  /** Its computer is offline: one row, with the way to bring it back. A state, never shown. */
  unavailable: 'Offline' | null
}

/**
 * Listed runtimes, grouped by device id (never display name); a computer that is offline is one
 * row and goes last. `signInChoices` folds each computer's signed-out ones away.
 */
export function selectorBoxes(
  agents: RuntimeInstance[],
  devices: AgentDevice[] = [],
): SelectorBox[] {
  const groups = new Map<string, SelectorBox>()
  const listed = listedAgents(agents)

  for (const agent of listed) {
    const deviceId = agent.local?.deviceId
    const id = deviceId
      ? `device:${deviceId}`
      : agent.kind === 'managed'
        ? 'cloud'
        : `runtime:${agent.id}`
    let group = groups.get(id)

    if (!group) {
      const device = devices.find((item) => item.deviceId === deviceId)

      group = {
        id,
        device,
        label:
          device?.label ?? agent.local?.deviceLabel ?? (id === 'cloud' ? t('Cloud') : agent.label),
        agents: [],
        unavailable: null,
      }
      groups.set(id, group)
    }
    group.agents.push(agent)
  }

  for (const group of groups.values()) {
    // Its agents' state, not unavailable()'s text: that is translated.
    if (group.agents.every((agent) => agent.local?.online === false)) group.unavailable = 'Offline'
  }

  return [...groups.values()].sort(
    (a, b) => Number(a.unavailable !== null) - Number(b.unavailable !== null),
  )
}

/**
 * A computer's menu offers the agents that can run now; the signed-out ones are sign-in choices
 * behind one entry. The selected agent stays listed, so its check stays visible.
 */
export function signInChoices(
  agents: readonly RuntimeInstance[],
  quotas?: ReadonlyMap<string, RuntimeQuota>,
  selectedId?: string,
) {
  const signedOut = (agent: RuntimeInstance) =>
    agent.id !== selectedId &&
    (agent.local?.signedIn === false || quotaSignedOut(quotas?.get(agent.id)))

  return {
    listed: agents.filter((agent) => !signedOut(agent)),
    signIn: agents.filter(signedOut),
  }
}

export type SelectorMetrics = NonNullable<ReturnType<typeof selectorMetrics>>

const validCapacity = (value: { used: number; total: number } | undefined) =>
  value !== undefined &&
  Number.isFinite(value.used) &&
  Number.isFinite(value.total) &&
  value.used >= 0 &&
  value.total > 0 &&
  value.used <= value.total

/** A live, sane reading, or null: the selector then shows no meters at all. */
export function selectorMetrics(device?: AgentDevice) {
  const sample = device?.metricsStatus === 'live' ? device.metrics : null

  if (
    !sample ||
    !Number.isFinite(sample.cpuPercent) ||
    sample.cpuPercent < 0 ||
    sample.cpuPercent > 100 ||
    !validCapacity(sample.memory) ||
    !validCapacity(sample.disk)
  )
    return null

  return {
    cpu: sample.cpuPercent,
    memory: (sample.memory.used / sample.memory.total) * 100,
    disk: (sample.disk.used / sample.disk.total) * 100,
    capacity: t('Memory {memory} · Disk {disk}', {
      memory: formatCapacity(sample.memory),
      disk: formatCapacity(sample.disk),
    }),
  }
}

function formatCapacity(value: { used: number; total: number }) {
  const gb = 1024 ** 3
  const format = (bytes: number) =>
    (bytes / gb).toLocaleString('en-US', { maximumFractionDigits: 1 })

  return `${format(value.used)} / ${format(value.total)} GB`
}

/** Inside its computer a runtime goes by its own name, or its provider's; never "<name> in <computer>". */
export function boxAgentName(agent: Pick<RuntimeInstance, 'label' | 'local' | 'provider'>): string {
  if (!agent.local) return agent.label

  return agent.local.agentLabel ?? AGENT_PROVIDER[agent.provider].label
}

/** Explicit grants win; older catalogs identify a teammate's computer with shared. */
export function showSharedComputerDisclosure(
  group: Pick<SelectorBox, 'device' | 'agents'>,
): boolean {
  if (group.device?.access) return group.device.access === 'use'

  return group.agents.some((agent) => Boolean(agent.local?.shared))
}

/**
 * "Shared by <owner>" on a teammate's own computer, so it is told apart from one of the viewer's
 * with a like name; null for their own computers, the team's cloud computers and a computer the
 * device list has not named an owner for yet.
 */
export function sharedBoxOwner(
  group: Pick<SelectorBox, 'device'>,
  members: readonly TeamMember[] | null,
): string | null {
  const owner = group.device && !group.device.box ? computerOwner(group.device) : null

  if (!owner) return null
  const name = ownerName(owner, members)

  return name ? t('Shared by {name}', { name }) : t('Shared by a teammate')
}
