import { randomUUID } from 'node:crypto'

import { logEvent } from '@/lib/observability'

import { RUNTIME_PRESENCE_HEARTBEAT_MS } from './presence'
import { desktopFrameSchema, holderChannel, parseJson, streamChannel } from './protocol'

import type { TunnelBus } from './bus'
import type { LocalRuntimePresenceStore } from './presence'
import type { BackendFrame, HolderMessage, LocalRuntimeStatus, StreamMessage } from './protocol'

export type TunnelConnection = {
  send(frame: BackendFrame): void
  close(code: number, reason: string): void
}

export type TunnelHolderDeps = {
  bus: TunnelBus
  presence: LocalRuntimePresenceStore
  isMember: (userId: string, teamId: string) => Promise<boolean>
  heartbeatMs?: number
  idleTimeoutMs?: number
}

export type RuntimeTunnel = {
  receive(raw: string): void
  closed(): void
}

const DEFAULT_IDLE_TIMEOUT_MS = 15_000

export const TUNNEL_CLOSE_SUPERSEDED = 4000
export const TUNNEL_CLOSE_IDLE = 4001

/**
 * Holds one desktop's reverse tunnel on this replica. Streams opened from any
 * replica arrive on the device's holder channel; frames for a stream go back on
 * that stream's own channel, so the replica running the conversation never
 * needs to reach the computer.
 */
export async function attachRuntimeTunnel(
  userId: string,
  deviceId: string,
  connection: TunnelConnection,
  deps: TunnelHolderDeps,
): Promise<RuntimeTunnel> {
  const conn = randomUUID()
  const streams = new Set<string>()
  const channel = holderChannel(userId, deviceId)
  let status: LocalRuntimeStatus | undefined
  let lastFrameAt = Date.now()
  let ended = false
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let unsubscribe = () => {}

  const toStream = (s: string, message: StreamMessage) =>
    deps.bus.publish(streamChannel(s), JSON.stringify(message)).catch(() => {})
  const refreshPresence = () =>
    deps.presence
      .put(userId, deviceId, { conn, ...(status ? { status } : {}), seenAt: Date.now() })
      .then((updated) => {
        if (!updated && !ended) {
          end()
          connection.close(TUNNEL_CLOSE_IDLE, 'Device presence expired')
        }
      })
      .catch(() => {
        end()
        connection.close(TUNNEL_CLOSE_IDLE, 'Device presence unavailable')
      })

  const end = () => {
    if (ended) return
    ended = true
    clearInterval(heartbeat)
    heartbeat = undefined
    unsubscribe()
    for (const s of streams)
      void toStream(s, { t: 'close', reason: 'The computer running this agent disconnected' })
    streams.clear()
    void deps.presence.clear(userId, deviceId, conn).catch(() => {})
  }

  const openStream = async (message: Extract<HolderMessage, { t: 'open' }>) => {
    const allowed = await deps.isMember(userId, message.teamId).catch(() => false)

    if (ended) return
    if (!allowed) {
      await toStream(message.s, {
        t: 'close',
        reason: 'The owner of this agent is not in this team',
      })

      return
    }
    streams.add(message.s)
    connection.send({
      t: 'open',
      s: message.s,
      purpose: message.purpose,
      provider: message.provider,
    })
  }

  const onHolderMessage = (raw: string) => {
    const message = parseJson<HolderMessage>(raw)

    if (!message || ended) return
    switch (message.t) {
      case 'supersede':
        if (message.previous ? message.previous !== conn : message.conn === conn) return
        end()
        connection.close(TUNNEL_CLOSE_SUPERSEDED, 'Another connection took over this computer')

        return
      case 'ping':
        if (message.conn === conn) connection.send({ t: 'ping' })

        return
      case 'open':
        if (message.conn === conn) void openStream(message)

        return
      case 'data':
        if (streams.has(message.s)) connection.send({ t: 'data', s: message.s, d: message.d })

        return
      case 'close':
        if (streams.delete(message.s)) connection.send({ t: 'close', s: message.s })
    }
  }

  unsubscribe = await deps.bus.subscribe(channel, onHolderMessage)
  heartbeat = setInterval(() => {
    if (Date.now() - lastFrameAt > (deps.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS)) {
      end()
      connection.close(TUNNEL_CLOSE_IDLE, 'No frames from the computer')

      return
    }
    void deps.bus
      .publish(channel, JSON.stringify({ t: 'ping', conn } satisfies HolderMessage))
      .catch(() => {
        end()
        connection.close(TUNNEL_CLOSE_IDLE, 'Device channel unavailable')
      })
  }, deps.heartbeatMs ?? RUNTIME_PRESENCE_HEARTBEAT_MS)

  try {
    const previous = await deps.presence.claim(userId, deviceId, conn)

    if (previous)
      await deps.bus.publish(
        channel,
        JSON.stringify({ t: 'supersede', conn, previous } satisfies HolderMessage),
      )
    await deps.bus.publish(channel, JSON.stringify({ t: 'ping', conn } satisfies HolderMessage))
  } catch (error) {
    end()
    throw error
  }
  logEvent('info', 'agent.local_runtime.tunnel_opened', { user_id: userId, device_id: deviceId })

  return {
    receive(raw) {
      if (ended) return
      const parsed = desktopFrameSchema.safeParse(parseJson(raw))

      if (!parsed.success) return
      const frame = parsed.data

      switch (frame.t) {
        case 'status':
          status = frame.status

          return
        case 'pong':
          lastFrameAt = Date.now()
          void refreshPresence()

          return
        case 'opened':
          if (streams.has(frame.s)) void toStream(frame.s, { t: 'opened' })

          return
        case 'data':
          if (streams.has(frame.s)) void toStream(frame.s, { t: 'data', d: frame.d })

          return
        case 'close':
          if (streams.delete(frame.s))
            void toStream(frame.s, {
              t: 'close',
              ...(frame.code === undefined ? {} : { code: frame.code }),
              ...(frame.reason ? { reason: frame.reason } : {}),
            })
      }
    },
    closed() {
      if (!ended)
        logEvent('info', 'agent.local_runtime.tunnel_closed', {
          user_id: userId,
          device_id: deviceId,
        })
      end()
    },
  }
}
