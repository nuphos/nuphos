import { io } from 'socket.io-client'

import { describeUnknown } from '@/lib/observability'

import { isUptimeKumaMonitor, SOCKET_TIMEOUT_MS, UptimeKumaApiError } from './uptime-kuma-core'
import {
  assertResolvedBaseUrlAllowed,
  normalizeUptimeKumaBaseUrl,
  safeAgentForUrl,
} from './uptime-kuma-network'

import type { KumaAck, UptimeKumaAuthHandle, UptimeKumaRawMonitor } from './uptime-kuma-core'
import type { Socket } from 'socket.io-client'

function socketErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function openSocket(baseUrl: string): Promise<Socket> {
  const normalizedBaseUrl = normalizeUptimeKumaBaseUrl(baseUrl)

  await assertResolvedBaseUrlAllowed(normalizedBaseUrl)
  const agent = safeAgentForUrl(normalizedBaseUrl)
  const socket = io(normalizedBaseUrl, {
    autoConnect: false,
    forceNew: true,
    reconnection: false,
    timeout: SOCKET_TIMEOUT_MS,
    transportOptions: {
      polling: { agent },
      websocket: { agent },
    },
  })

  return await new Promise<Socket>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.disconnect()
      reject(new UptimeKumaApiError(504, 'Timed out connecting to Uptime Kuma'))
    }, SOCKET_TIMEOUT_MS)

    socket.once('connect', () => {
      clearTimeout(timer)
      resolve(socket)
    })
    socket.once('connect_error', (err) => {
      clearTimeout(timer)
      socket.disconnect()
      reject(
        new UptimeKumaApiError(502, `Could not connect to Uptime Kuma: ${socketErrorMessage(err)}`),
      )
    })
    socket.connect()
  })
}

export async function emitAck<T = KumaAck>(
  socket: Socket,
  event: string,
  ...args: unknown[]
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    socket.timeout(SOCKET_TIMEOUT_MS).emit(event, ...args, (err: Error | null, res: T) => {
      if (err) {
        reject(new UptimeKumaApiError(504, `Uptime Kuma ${event} timed out: ${err.message}`))

        return
      }
      resolve(res)
    })
  })
}

export async function waitForEvent<T>(
  socket: Socket,
  event: string,
  trigger: () => Promise<unknown>,
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      socket.off(event, onEvent)
    }

    const onEvent = (payload: T) => {
      cleanup()
      resolve(payload)
    }

    const timer = setTimeout(() => {
      cleanup()
      reject(new UptimeKumaApiError(504, `Uptime Kuma ${event} timed out`))
    }, SOCKET_TIMEOUT_MS)

    socket.once(event, onEvent)
    trigger().catch((err: unknown) => {
      cleanup()
      reject(err instanceof Error ? err : new UptimeKumaApiError(502, describeUnknown(err)))
    })
  })
}

export function assertOk(res: KumaAck, operation: string): KumaAck {
  if (!res || res.ok === false) {
    const message = res?.tokenRequired
      ? 'Uptime Kuma requires a 2FA token for password login; use a saved auth token instead'
      : res?.msg || `Uptime Kuma ${operation} failed`

    throw new UptimeKumaApiError(res?.tokenRequired ? 401 : 502, message)
  }

  return res
}

export async function login(socket: Socket, handle: UptimeKumaAuthHandle): Promise<void> {
  if (handle.authToken) {
    assertOk(await emitAck(socket, 'loginByToken', handle.authToken), 'loginByToken')

    return
  }
  if (!handle.username || !handle.password) {
    throw new UptimeKumaApiError(400, 'Uptime Kuma username/password or auth token is required')
  }
  assertOk(
    await emitAck(socket, 'login', {
      username: handle.username,
      password: handle.password,
    }),
    'login',
  )
}

export async function withSocket<T>(
  handle: UptimeKumaAuthHandle,
  fn: (socket: Socket) => Promise<T>,
): Promise<T> {
  const socket = await openSocket(handle.baseUrl)

  try {
    await login(socket, handle)

    return await fn(socket)
  } finally {
    socket.disconnect()
  }
}

export async function getRawMonitor(
  socket: Socket,
  monitorId: number,
): Promise<UptimeKumaRawMonitor> {
  const res = assertOk(await emitAck(socket, 'getMonitor', monitorId), 'getMonitor')

  if (!isUptimeKumaMonitor(res.monitor)) {
    throw new UptimeKumaApiError(404, `Uptime Kuma monitor ${String(monitorId)} was not returned`)
  }

  return res.monitor
}
