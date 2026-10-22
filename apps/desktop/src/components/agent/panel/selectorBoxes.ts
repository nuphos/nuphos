import type { AgentDevice } from '../../../api/device-types'
import type { RuntimeInstance } from '../../../types/runtime'

export type SelectorBox = {
  id: string
  label: string
  device?: AgentDevice
  agents: RuntimeInstance[]
}

/** Device ids, never display names, define a Box. Keep signed-out/offline agents discoverable. */
export function selectorBoxes(
  agents: RuntimeInstance[],
  devices: AgentDevice[] = [],
): SelectorBox[] {
  const groups = new Map<string, SelectorBox>()

  for (const agent of agents) {
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

export type SelectorMetrics = ReturnType<typeof selectorMetrics>

export function selectorMetrics(device?: AgentDevice) {
  const sample =
    device?.online !== false && device?.metricsStatus === 'live' ? device.metrics : null
  const percent = (value: number | undefined) =>
    value !== undefined && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null
  const capacity = (value: { used: number; total: number } | undefined) =>
    value &&
    Number.isFinite(value.used) &&
    Number.isFinite(value.total) &&
    value.used >= 0 &&
    value.total > 0 &&
    value.used <= value.total
      ? value
      : null
  const memory = capacity(sample?.memory)
  const disk = capacity(sample?.disk)

  return {
    cpu: percent(sample?.cpuPercent),
    memory: memory ? (memory.used / memory.total) * 100 : null,
    disk: disk ? (disk.used / disk.total) * 100 : null,
    capacity:
      memory && disk ? `Memory ${formatCapacity(memory)} · Disk ${formatCapacity(disk)}` : null,
  }
}

function formatCapacity(value: { used: number; total: number }) {
  const gb = 1024 ** 3
  const format = (bytes: number) =>
    (bytes / gb).toLocaleString('en-US', { maximumFractionDigits: 1 })

  return `${format(value.used)} / ${format(value.total)} GB`
}

export function selectorSignIn(
  agent: RuntimeInstance,
  device: AgentDevice | undefined,
  admin: boolean,
): 'login' | 'instructions' | null {
  if (agent.local) return device?.box && device.access !== 'use' ? 'login' : 'instructions'

  return admin ? 'login' : null
}
