import { readDeviceMetrics } from '../main/device-metrics.ts'

import { call } from './client.ts'

import type {
  AgentDevice,
  AgentDeviceList,
  AgentDeviceListOptions,
  DeviceAgentInstance,
  LocalAgentProvider,
} from '../../src/api/device-types.ts'

// Boxes belong to a team: every Box route is scoped to the page's team.
const deviceRoute = (deviceId: string, teamId: string) =>
  `/agent/devices/${encodeURIComponent(deviceId)}?teamId=${encodeURIComponent(teamId)}`
const box = (deviceId: string, action: string, teamId: string) =>
  `/agent/devices/${encodeURIComponent(deviceId)}/box${action}?teamId=${encodeURIComponent(teamId)}`

function listQuery(metrics: boolean, teamId: string | undefined): string {
  const query = new URLSearchParams()

  if (metrics) query.set('metrics', 'true')
  if (teamId) query.set('teamId', teamId)

  return query.size ? `?${query.toString()}` : ''
}

export async function listAgentDevices(options?: AgentDeviceListOptions): Promise<AgentDeviceList> {
  const demand = options?.metrics === true
  const [list, metrics] = await Promise.all([
    call<AgentDeviceList>('GET', `/agent/devices${listQuery(demand, options?.teamId)}`),
    demand ? readDeviceMetrics() : null,
  ])

  if (!demand) return list
  const { readDeviceIdentity } = await import('../main/device-identity.ts')
  const { deviceId } = readDeviceIdentity()

  return {
    ...list,
    devices: list.devices.map((device) =>
      device.deviceId === deviceId
        ? {
            ...device,
            metrics,
            metricsStatus: metrics ? 'live' : 'waiting',
            metricsReceivedAt: metrics ? new Date().toISOString() : null,
          }
        : device,
    ),
  }
}
export function createBox(label?: string, teamId?: string): Promise<AgentDevice> {
  return call(
    'POST',
    '/agent/devices/boxes',
    { ...(label ? { label } : {}), ...(teamId ? { teamId } : {}) },
    { retry: false },
  )
}
/** Add another agent on a device. A cold host can take most of a minute, so wait past the backend's own 60s. */
export function createDeviceAgent(
  deviceId: string,
  teamId: string,
  provider: LocalAgentProvider,
): Promise<DeviceAgentInstance> {
  return call(
    'POST',
    `/agent/devices/${encodeURIComponent(deviceId)}/agents`,
    { teamId, provider },
    { retry: false, timeoutMs: 65_000 },
  )
}
export function pauseBox(deviceId: string, teamId: string): Promise<AgentDevice> {
  return call('POST', box(deviceId, '/pause', teamId), undefined, { retry: false })
}
export function resumeBox(deviceId: string, teamId: string): Promise<AgentDevice> {
  return call('POST', box(deviceId, '/resume', teamId), undefined, { retry: false })
}
export function renameBox(deviceId: string, teamId: string, label: string): Promise<{ ok: true }> {
  return call('PATCH', deviceRoute(deviceId, teamId), { label }, { retry: false })
}
export function boxDesktop(deviceId: string, teamId: string): Promise<{ url: string }> {
  return call('POST', box(deviceId, '/desktop', teamId), undefined, { retry: false })
}
export function boxJoinToken(): Promise<{
  token: string
  expiresAt: string
  apiUrl: string | null
}> {
  return call('POST', '/agent/devices/join-tokens', { expiresInSec: 3600 }, { retry: false })
}
export function deleteBox(deviceId: string, teamId: string): Promise<{ ok: true }> {
  return call('DELETE', box(deviceId, '', teamId), undefined, { retry: false })
}
