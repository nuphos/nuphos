import { usable } from '../../../lib/agentName.ts'
import { quotaSignedOut } from '../../../lib/runtimeQuota.ts'
import { AGENT_PROVIDER } from '../../../types/runtime.ts'

import type { AgentDevice } from '../../../api/device-types'
import type { RuntimeInstance, RuntimeQuota } from '../../../types/runtime'

export type SelectorBox = {
  id: string
  label: string
  device?: AgentDevice
  agents: RuntimeInstance[]
}

/**
 * Only runtimes that can take a turn now, grouped by device id (never display name). A computer
 * that is offline, or whose runtimes all need a sign-in, is left out.
 */
export function selectorBoxes(
  agents: RuntimeInstance[],
  devices: AgentDevice[] = [],
  quotas?: ReadonlyMap<string, RuntimeQuota>,
): SelectorBox[] {
  const groups = new Map<string, SelectorBox>()
  const ready = (agent: RuntimeInstance) => usable(agent) && !quotaSignedOut(quotas?.get(agent.id))

  for (const agent of agents.filter(ready)) {
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
          device?.label ?? agent.local?.deviceLabel ?? (id === 'cloud' ? 'Cloud' : agent.label),
        agents: [],
      }
      groups.set(id, group)
    }
    group.agents.push(agent)
  }

  return [...groups.values()]
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
    capacity: `Memory ${formatCapacity(sample.memory)} · Disk ${formatCapacity(sample.disk)}`,
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
