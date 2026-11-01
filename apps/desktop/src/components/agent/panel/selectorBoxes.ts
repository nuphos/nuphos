import { listedAgents, unavailable } from '../../../lib/agentName.ts'
import { t } from '../../../i18n/index.ts'
import { quotaSignedOut } from '../../../lib/runtimeQuota.ts'
import { AGENT_PROVIDER } from '../../../types/runtime.ts'

import type { AgentDevice } from '../../../api/device-types'
import type { RuntimeInstance, RuntimeQuota } from '../../../types/runtime'

export type SelectorBox = {
  id: string
  label: string
  device?: AgentDevice
  agents: RuntimeInstance[]
  /** Why none of its runtimes can be picked: shown greyed out with this. */
  unavailable: ReturnType<typeof unavailable>
}

/**
 * Listed runtimes, grouped by device id (never display name). A computer offers only the runtimes
 * that can take a turn; with none, it is unavailable for the first one's reason and goes last.
 */
export function selectorBoxes(
  agents: RuntimeInstance[],
  devices: AgentDevice[] = [],
  quotas?: ReadonlyMap<string, RuntimeQuota>,
): SelectorBox[] {
  const groups = new Map<string, SelectorBox>()
  const listed = listedAgents(agents).filter((agent) => !quotaSignedOut(quotas?.get(agent.id)))

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
    const ready = group.agents.filter((agent) => !unavailable(agent))

    if (ready.length) group.agents = ready
    else group.unavailable = group.agents[0] ? unavailable(group.agents[0]) : null
  }

  return [...groups.values()].sort(
    (a, b) => Number(a.unavailable !== null) - Number(b.unavailable !== null),
  )
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
