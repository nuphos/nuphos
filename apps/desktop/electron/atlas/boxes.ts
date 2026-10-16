import { readDeviceMetrics } from '../main/device-metrics.ts'

import { call, readToken } from './client.ts'
import { buildAtlasError } from './error.ts'

import type {
  AgentDevice,
  AgentDeviceList,
  AgentDeviceListOptions,
  BillingSummary,
  BoxUsage,
  BoxUsageHistory,
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
/** Add another agent on a device: the Box records it pending and answers at once; it exists once signed in. */
export function createDeviceAgent(
  deviceId: string,
  teamId: string,
  provider: LocalAgentProvider,
): Promise<DeviceAgentInstance> {
  return call(
    'POST',
    `/agent/devices/${encodeURIComponent(deviceId)}/agents`,
    { teamId, provider },
    { retry: false },
  )
}
/** Drop an added agent and its sign-in. The Box first lets a still-starting one finish starting. */
export function removeDeviceAgent(
  deviceId: string,
  teamId: string,
  instanceId: string,
): Promise<void> {
  return call(
    'DELETE',
    `/agent/devices/${encodeURIComponent(deviceId)}/agents/${encodeURIComponent(instanceId)}?teamId=${encodeURIComponent(teamId)}`,
    undefined,
    { retry: false, timeoutMs: 50_000 },
  )
}
export function pauseBox(deviceId: string, teamId: string): Promise<AgentDevice> {
  return call('POST', box(deviceId, '/pause', teamId), undefined, { retry: false })
}
export function resumeBox(deviceId: string, teamId: string): Promise<AgentDevice> {
  return call('POST', box(deviceId, '/resume', teamId), undefined, { retry: false })
}
/** `agent` is an added agent's instance id, or the provider for the computer's own. An
 *  empty label gives it back its default name. */
export function renameDeviceAgent(
  deviceId: string,
  teamId: string,
  agent: string,
  label: string,
): Promise<{ ok: true }> {
  return call(
    'PATCH',
    `/agent/devices/${encodeURIComponent(deviceId)}/agents/${encodeURIComponent(agent)}`,
    { teamId, label },
    { retry: false },
  )
}
export function setBoxAccess(
  deviceId: string,
  teamId: string,
  access: { everyone: boolean; userIds: string[] },
): Promise<unknown> {
  return call('PUT', box(deviceId, '/access', teamId), access, { retry: false })
}
export function renameBox(deviceId: string, teamId: string, label: string): Promise<{ ok: true }> {
  return call('PATCH', deviceRoute(deviceId, teamId), { label }, { retry: false })
}
export function boxDesktop(
  deviceId: string,
  teamId: string,
): Promise<{ url: string; label: string }> {
  return call('POST', box(deviceId, '/desktop', teamId), undefined, { retry: false })
}
/** Has the conversation's Box hold a desktop for it: its own when it has one. */
export function openSessionDesktop(
  teamId: string,
  sessionId: string,
): Promise<{ display: number }> {
  return call(
    'POST',
    `/teams/${encodeURIComponent(teamId)}/runtime-desktop/${encodeURIComponent(sessionId)}`,
    undefined,
    { retry: false },
  )
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

/** Forgets an offline computer; the backend refuses Boxes and computers that are online. */
export function removeDevice(deviceId: string, teamId: string): Promise<{ ok: true }> {
  return call('DELETE', deviceRoute(deviceId, teamId), undefined, { retry: false })
}

export function getBoxUsage(teamId: string): Promise<BoxUsage> {
  return call('GET', `/teams/${encodeURIComponent(teamId)}/box-usage`)
}

export function getBoxUsageHistory(
  teamId: string,
  range: '1d' | '7d' | '30d',
): Promise<BoxUsageHistory> {
  return call('GET', `/teams/${encodeURIComponent(teamId)}/box-usage/history?range=${range}`)
}

/** What the billing service's errors (`{ error }` only) mean to the user. */
const BILLING_ERRORS: Record<string, string> = {
  checkout_in_progress: 'A checkout for this team is already in progress; try again shortly',
  forbidden: 'Only team administrators can manage billing',
  no_customer: 'Choose a plan first',
}

/**
 * Calls the billing service, a separate origin whose CORS takes only Authorization
 * and Content-Type, hence a plain fetch. Answers the error code instead of throwing it.
 */
async function billing(teamId: string, method: 'GET' | 'POST', page: string, body?: unknown) {
  const { billingUrl } = await getBoxUsage(teamId)

  if (!billingUrl) throw new Error('This deployment has no billing service')
  const response = await fetch(`${billingUrl}/teams/${encodeURIComponent(teamId)}/${page}`, {
    method,
    headers: {
      Authorization: `Bearer ${(await readToken()) ?? ''}`,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const json = (await response.json().catch(() => ({}))) as { error?: string }

  return response.ok
    ? { ok: true as const, value: json as unknown }
    : { ok: false as const, error: json.error ?? `billing_${String(response.status)}` }
}

function billingError(error: string): Error {
  return buildAtlasError(BILLING_ERRORS[error] ?? `Billing answered ${error}`, error)
}

/** Checkout for a `vcpus` plan, or the portal without one or for a team that already has one. */
export async function boxBillingPage(teamId: string, vcpus?: number): Promise<{ url: string }> {
  let page =
    vcpus === undefined
      ? await billing(teamId, 'POST', 'portal')
      : await billing(teamId, 'POST', 'checkout', {
          plan: `nuphos_box_${String(vcpus)}vcpu_monthly`,
        })

  if (!page.ok && page.error === 'already_subscribed')
    page = await billing(teamId, 'POST', 'portal')
  if (!page.ok) throw billingError(page.error)

  return page.value as { url: string }
}

export async function boxBillingSummary(teamId: string): Promise<BillingSummary> {
  const summary = await billing(teamId, 'GET', 'subscription')

  if (!summary.ok) throw billingError(summary.error)

  return summary.value as BillingSummary
}
