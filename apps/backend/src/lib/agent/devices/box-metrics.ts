import { tunnelBus } from './local-runtime/bus'
import { runtimePresenceStore } from './local-runtime/presence'
import { holderChannel } from './local-runtime/protocol'

import type { TunnelBus } from './local-runtime/bus'
import type { LocalRuntimePresenceStore } from './local-runtime/presence'
import type { HolderMessage } from './local-runtime/protocol'
import type { BoxMetrics } from './metrics-schema'

export type BoxMetricsReading = {
  metrics: BoxMetrics | null
  metricsStatus: 'offline' | 'unsupported' | 'waiting' | 'stale' | 'live'
  metricsReceivedAt: string | null
}

/** Reads only reports from an already-connected host. Never reaches the cloud provider. */
export async function readBoxMetrics(
  userId: string,
  deviceId: string,
  demand = false,
  deps: { presence: LocalRuntimePresenceStore; bus: TunnelBus; now?: () => number } = {
    presence: runtimePresenceStore(),
    bus: tunnelBus(),
  },
): Promise<BoxMetricsReading> {
  const empty = { metrics: null, metricsReceivedAt: null }

  const presence = await deps.presence.get(userId, deviceId)

  if (!presence) return { ...empty, metricsStatus: 'offline' }
  if (!presence.status?.localMetrics) return { ...empty, metricsStatus: 'unsupported' }
  if (demand)
    await deps.bus.publish(
      holderChannel(userId, deviceId),
      JSON.stringify({
        t: 'metrics',
        conn: presence.conn,
        leaseMs: 12_000,
      } satisfies HolderMessage),
    )
  if (!presence.metrics || !presence.metricsReceivedAt)
    return { ...empty, metricsStatus: 'waiting' }
  const age = (deps.now?.() ?? Date.now()) - presence.metricsReceivedAt

  return {
    metrics: presence.metrics,
    metricsReceivedAt: new Date(presence.metricsReceivedAt).toISOString(),
    metricsStatus: age >= 12_000 || age < 0 ? 'stale' : 'live',
  }
}
