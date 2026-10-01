import {
  sanitizeUptimeKumaMonitor,
  sanitizeUptimeKumaMonitorList,
  UptimeKumaApiError,
} from './uptime-kuma-core'
import {
  assertOk,
  emitAck,
  getRawMonitor,
  login,
  openSocket,
  waitForEvent,
  withSocket,
} from './uptime-kuma-socket'

import type {
  UptimeKumaAuthHandle,
  UptimeKumaMonitor,
  UptimeKumaRawMonitor,
} from './uptime-kuma-core'

export { sanitizeUptimeKumaMonitor, UptimeKumaApiError } from './uptime-kuma-core'
export type { UptimeKumaAuthHandle, UptimeKumaMonitor } from './uptime-kuma-core'
export { blockedUptimeKumaHostReason, normalizeUptimeKumaBaseUrl } from './uptime-kuma-network'

export async function verifyUptimeKumaCredentials(handle: UptimeKumaAuthHandle): Promise<void> {
  await withSocket(handle, async () => undefined)
}

export async function listUptimeKumaMonitors(
  handle: UptimeKumaAuthHandle,
): Promise<UptimeKumaMonitor[]> {
  const socket = await openSocket(handle.baseUrl)
  let pushedMonitorList: Record<string, UptimeKumaRawMonitor> | null = null
  const onMonitorList = (payload: Record<string, UptimeKumaRawMonitor>) => {
    pushedMonitorList = payload
  }

  socket.on('monitorList', onMonitorList)
  try {
    await login(socket, handle)
    if (pushedMonitorList) return sanitizeUptimeKumaMonitorList(pushedMonitorList)
    const res = await waitForEvent<Record<string, UptimeKumaRawMonitor>>(
      socket,
      'monitorList',
      async () => {
        assertOk(await emitAck(socket, 'getMonitorList'), 'getMonitorList')
      },
    )

    return sanitizeUptimeKumaMonitorList(res)
  } finally {
    socket.off('monitorList', onMonitorList)
    socket.disconnect()
  }
}

export async function getUptimeKumaMonitor(
  handle: UptimeKumaAuthHandle,
  monitorId: number,
): Promise<UptimeKumaMonitor> {
  return await withSocket(handle, async (socket) =>
    sanitizeUptimeKumaMonitor(await getRawMonitor(socket, monitorId)),
  )
}

function monitorPayload(input: Record<string, unknown>, defaults: Record<string, unknown> = {}) {
  const payload: Record<string, unknown> = {
    ...defaults,
    ...input,
  }

  if (Array.isArray(payload.acceptedStatusCodes) && !Array.isArray(payload.accepted_statuscodes)) {
    payload.accepted_statuscodes = payload.acceptedStatusCodes
  }
  delete payload.acceptedStatusCodes

  payload.type = typeof payload.type === 'string' ? payload.type : 'http'
  payload.method = typeof payload.method === 'string' ? payload.method : 'GET'
  payload.interval = typeof payload.interval === 'number' ? payload.interval : 60
  payload.retryInterval = typeof payload.retryInterval === 'number' ? payload.retryInterval : 60
  payload.resendInterval = typeof payload.resendInterval === 'number' ? payload.resendInterval : 0
  payload.maxretries = typeof payload.maxretries === 'number' ? payload.maxretries : 0
  payload.active = typeof payload.active === 'boolean' ? payload.active : true
  payload.accepted_statuscodes = Array.isArray(payload.accepted_statuscodes)
    ? payload.accepted_statuscodes
    : ['200-299']
  payload.notificationIDList =
    payload.notificationIDList && typeof payload.notificationIDList === 'object'
      ? payload.notificationIDList
      : {}
  payload.conditions = Array.isArray(payload.conditions) ? payload.conditions : []

  return payload
}

export async function createUptimeKumaMonitor(
  handle: UptimeKumaAuthHandle,
  input: Record<string, unknown>,
): Promise<{ monitorID: number; monitor: UptimeKumaMonitor | null }> {
  return await withSocket(handle, async (socket) => {
    const res = assertOk(await emitAck(socket, 'add', monitorPayload(input)), 'add monitor')
    const monitorID = Number(res.monitorID)

    if (!Number.isInteger(monitorID) || monitorID <= 0) {
      throw new UptimeKumaApiError(502, 'Uptime Kuma did not return a valid monitor id')
    }
    const monitor = await getRawMonitor(socket, monitorID).catch(() => null)

    return { monitorID, monitor: monitor ? sanitizeUptimeKumaMonitor(monitor) : null }
  })
}

export async function updateUptimeKumaMonitor(
  handle: UptimeKumaAuthHandle,
  monitorId: number,
  patch: Record<string, unknown>,
): Promise<UptimeKumaMonitor> {
  return await withSocket(handle, async (socket) => {
    const current = await getRawMonitor(socket, monitorId)
    const payload = monitorPayload(patch, current)

    payload.id = monitorId
    assertOk(await emitAck(socket, 'editMonitor', payload), 'edit monitor')

    return sanitizeUptimeKumaMonitor(await getRawMonitor(socket, monitorId))
  })
}

export async function pauseUptimeKumaMonitor(
  handle: UptimeKumaAuthHandle,
  monitorId: number,
): Promise<void> {
  await withSocket(handle, async (socket) => {
    assertOk(await emitAck(socket, 'pauseMonitor', monitorId), 'pause monitor')
  })
}

export async function resumeUptimeKumaMonitor(
  handle: UptimeKumaAuthHandle,
  monitorId: number,
): Promise<void> {
  await withSocket(handle, async (socket) => {
    assertOk(await emitAck(socket, 'resumeMonitor', monitorId), 'resume monitor')
  })
}

export async function deleteUptimeKumaMonitor(
  handle: UptimeKumaAuthHandle,
  monitorId: number,
  deleteChildren = false,
): Promise<void> {
  await withSocket(handle, async (socket) => {
    assertOk(await emitAck(socket, 'deleteMonitor', monitorId, deleteChildren), 'delete monitor')
  })
}
