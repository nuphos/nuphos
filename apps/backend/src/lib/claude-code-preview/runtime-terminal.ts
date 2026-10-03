import { randomUUID } from 'node:crypto'

import { getReadableConversation } from '@/lib/agent/db'
import { AppError } from '@/lib/errors'

import { resolveLocalRuntimeEndpoint } from './local-runtime-catalog'
import { OpenAbAcpClient } from './openab-acp-client'
import { developmentRuntimeEndpoint, requireRuntimeInstance } from './runtime-catalog'
import { resolveTeamRuntimeEndpoints } from './runtime-registry'

import type { WSEvents, WSContext } from 'hono/ws'

// Admission is synchronous per backend process; the runtime enforces its global PTY cap.
const activeTerminals = new Map<string, number>()

export async function runtimeTerminalTarget(teamId: string, userId: string, sessionId: string) {
  const conversation = await getReadableConversation(sessionId, userId, teamId)

  if (
    !conversation ||
    conversation.userId !== userId ||
    conversation.teamId !== teamId ||
    !conversation.runtimeId
  )
    throw new AppError(404, 'not_found', 'Conversation runtime not found')
  const runtime = await requireRuntimeInstance(teamId, conversation.runtimeId, userId)
  const endpoint =
    runtime.kind === 'local'
      ? await resolveLocalRuntimeEndpoint(teamId, runtime.id, userId, 'control')
      : runtime.kind === 'development'
        ? developmentRuntimeEndpoint(runtime.provider, 'control')
        : (await resolveTeamRuntimeEndpoints(teamId, undefined, runtime.provider, 'control')).find(
            (item) => item.runtimeId === runtime.id,
          )

  if (runtime.status !== 'active' || !endpoint)
    throw new AppError(503, 'runtime_unavailable', 'The conversation runtime is offline')

  return { endpoint, runtimeId: runtime.id, label: runtime.label, sessionId, userId }
}

function dimension(value: string | undefined, fallback: number) {
  const number = Number(value)

  return Number.isInteger(number) ? Math.max(2, Math.min(500, number)) : fallback
}

/** A dedicated existing ACP connection owns this terminal, so replicas need no session map. */
export function runtimeTerminalEvents(
  target: Awaited<ReturnType<typeof runtimeTerminalTarget>>,
  size: { cols?: string; rows?: string } = {},
): WSEvents {
  let client: OpenAbAcpClient | undefined
  let stopped = false
  let ready = false
  let pending = 0
  let admitted = false
  const terminalId = randomUUID()
  const close = () => {
    stopped = true
    if (admitted) {
      admitted = false
      const count = (activeTerminals.get(target.userId) ?? 1) - 1

      if (count) activeTerminals.set(target.userId, count)
      else activeTerminals.delete(target.userId)
    }
    client?.close()
  }

  async function start(ws: WSContext) {
    try {
      const count = activeTerminals.get(target.userId) ?? 0

      if (count >= 8) throw new Error('Close a runtime terminal before opening another one.')
      activeTerminals.set(target.userId, count + 1)
      admitted = true
      client = await OpenAbAcpClient.connect(target.endpoint)
      if (stopped) {
        client.close()

        return
      }
      client.onClosed(() => {
        close()
        ws.close()
      })
      const initialized = await client.initialize()
      const capabilities = initialized.agentCapabilities as
        { _meta?: Record<string, unknown> } | undefined

      if (capabilities?._meta?.['dev.openab/runtimeTerminal'] !== true)
        throw new Error(
          'This runtime does not offer interactive terminals. Update it and enable terminal support.',
        )
      client.onTerminalFrame = (frame) => {
        if (stopped) return
        try {
          ws.send(JSON.stringify(frame))
        } catch {
          close()
          ws.close()

          return
        }
        if ((frame as { type?: string } | null)?.type === 'exit') {
          close()
          ws.close()
        }
      }
      await client.terminalRequest('start', {
        terminalId,
        sessionId: target.sessionId,
        cols: dimension(size.cols, 80),
        rows: dimension(size.rows, 24),
      })
      if (stopped) {
        client.close()

        return
      }
      ready = true
      ws.send(JSON.stringify({ type: 'ready', runtimeId: target.runtimeId, label: target.label }))
    } catch (error) {
      if (!stopped)
        ws.send(
          JSON.stringify({
            type: 'error',
            message:
              error instanceof Error &&
              (error.message.startsWith('This runtime does not offer') ||
                error.message.startsWith('Close a runtime terminal'))
                ? error.message
                : 'Could not connect to the runtime terminal.',
          }),
        )
      close()
      ws.close()
    }
  }

  return {
    onOpen(_event, ws) {
      void start(ws).catch(() => {
        close()
        ws.close()
      })
    },
    onMessage(event, ws) {
      // JSON can encode one input byte as six characters (for example \u0000).
      // Reject only this oversized frame; the PTY and its tab remain usable.
      if (typeof event.data === 'string' && event.data.length > 6 * 16384 + 64) return
      if (stopped || typeof event.data !== 'string' || ++pending > 32) {
        close()
        ws.close()

        return
      }
      void (async () => {
        if (stopped) return
        const value = JSON.parse(event.data as string) as {
          type: string
          sequence?: number
          data?: string
          cols?: number
          rows?: number
        }

        if (!ready && value.type !== 'ack') throw new Error('Terminal is not ready')
        if (value.type === 'ack' && Number.isSafeInteger(value.sequence))
          await client?.terminalRequest('ack', { terminalId, sequence: value.sequence })
        else if (value.type === 'input' && typeof value.data === 'string') {
          if (Buffer.byteLength(value.data, 'utf8') > 16384) return
          await client?.terminalRequest('input', { terminalId, data: value.data })
        } else if (
          value.type === 'resize' &&
          Number.isInteger(value.cols) &&
          Number.isInteger(value.rows)
        )
          await client?.terminalRequest('resize', {
            terminalId,
            cols: value.cols,
            rows: value.rows,
          })
        else throw new Error('Invalid terminal frame')
      })()
        .catch(() => {
          close()
          ws.close()
        })
        .finally(() => {
          pending--
        })
    },
    onClose: close,
    onError: close,
  }
}
