import { isLocalRuntimeUrl } from '../agent/devices/local-runtime/address.ts'
import { openLocalRuntimeSocket } from '../agent/devices/local-runtime/socket.ts'

import { connectionFailureMessage } from './openab-acp-errors.ts'

import type { AcpSocket, OpenAbAcpClientOptions, SocketFactory } from './openab-acp-session.ts'

type SocketEvent = { code?: number; message?: string; reason?: string }

export type OpenAbAcpConnection = {
  socket: AcpSocket
  callTimeoutMs: number
  promptTimeoutMs: number
  promptProgressTimeoutMs: number
  retireGraceMs: number
}

const defaultSocketFactory: SocketFactory = (url, protocols) =>
  isLocalRuntimeUrl(url) ? openLocalRuntimeSocket(url, protocols) : new WebSocket(url, protocols)
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000
const DEFAULT_CALL_TIMEOUT_MS = 30_000
// Re-armed by every session/update, heartbeats included; catches a dead socket
// or runtime and matches the gateway's idle default.
const DEFAULT_PROMPT_TIMEOUT_MS = 180_000
// Re-armed only by turn progress. openab's pool abandons a prompt after
// prompt_hard_timeout_secs (30 min) without agent activity, plus hung_grace_secs
// (120s); this sits just above so openab's own cancel acts first when it can.
const DEFAULT_PROMPT_PROGRESS_TIMEOUT_MS = 32 * 60_000
const DEFAULT_RETIRE_GRACE_MS = 30_000

export async function connectOpenAbAcpSocket(
  options: OpenAbAcpClientOptions,
): Promise<OpenAbAcpConnection> {
  const socket = (options.socketFactory ?? defaultSocketFactory)(options.url, [
    `openab.bearer.${options.authKey}`,
    'acp.v1',
  ])

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      socket.close()
      reject(new Error('OpenAB ACP connection timed out'))
    }, options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS)
    const onOpen = () => {
      cleanup()
      resolve()
    }
    const onFailure = (event: SocketEvent) => {
      cleanup()
      reject(new Error(connectionFailureMessage(event)))
    }
    const cleanup = () => {
      clearTimeout(timer)
      socket.removeEventListener('open', onOpen)
      socket.removeEventListener('error', onFailure)
      socket.removeEventListener('close', onFailure)
    }

    socket.addEventListener('open', onOpen)
    socket.addEventListener('error', onFailure)
    socket.addEventListener('close', onFailure)
  })

  return {
    socket,
    callTimeoutMs: options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
    promptTimeoutMs: options.promptTimeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS,
    promptProgressTimeoutMs: options.promptProgressTimeoutMs ?? DEFAULT_PROMPT_PROGRESS_TIMEOUT_MS,
    retireGraceMs: options.retireGraceMs ?? DEFAULT_RETIRE_GRACE_MS,
  }
}
