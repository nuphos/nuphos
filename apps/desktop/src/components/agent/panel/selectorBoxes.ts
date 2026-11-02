import { t } from '../../../i18n/index.ts'
import { listedAgents, unavailable } from '../../../lib/agentName.ts'
import { quotaSignedOut } from '../../../lib/runtimeQuota.ts'
import { AGENT_PROVIDER } from '../../../types/runtime.ts'

import type { AgentDevice } from '../../../api/device-types'
import type { RuntimeInstance, RuntimeQuota } from '../../../types/runtime'

export type SelectorBox = {
  id: string
  label: string
  device?: AgentDevice
  agents: RuntimeInstance[]
  /** Its computer is offline: one row, with the way to bring it back. */
  unavailable: ReturnType<typeof unavailable>
}

/**
 * Listed runtimes, grouped by device id (never display name). A signed-out runtime stays listed so
 * it can be signed in from here; a computer that is offline is one row and goes last.
 */
export function selectorBoxes(
  agents: RuntimeInstance[],
  devices: AgentDevice[] = [],
  quotas?: ReadonlyMap<string, RuntimeQuota>,
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
    // Ready ones first, then the ones the picker can sign in.
    group.agents.sort((a, b) => Number(signedOut(a, quotas)) - Number(signedOut(b, quotas)))
    if (group.agents.every((agent) => unavailable(agent) === 'Offline'))
      group.unavailable = 'Offline'
  }

  return [...groups.values()].sort(
    (a, b) => Number(a.unavailable !== null) - Number(b.unavailable !== null),
  )
}

function signedOut(agent: RuntimeInstance, quotas?: ReadonlyMap<string, RuntimeQuota>) {
  return unavailable(agent) !== null || quotaSignedOut(quotas?.get(agent.id))
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
