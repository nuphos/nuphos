import { randomUUID } from 'node:crypto'

import { logEvent } from '@/lib/observability'

import { reportedAgents } from '../agent-registry'

import { RUNTIME_PRESENCE_HEARTBEAT_MS } from './presence'
import { desktopFrameSchema, holderChannel, parseJson, streamChannel } from './protocol'

import type { RuntimeTunnel, TunnelConnection, TunnelHolderDeps } from './holder-types'
import type { BoxMetrics } from '../metrics-schema'
import type { HolderMessage, LocalRuntimeStatus, StreamMessage } from './protocol'

export type { RuntimeTunnel, TunnelConnection, TunnelHolderDeps } from './holder-types'

const DEFAULT_IDLE_TIMEOUT_MS = 15_000
const DEFAULT_CHANNEL_TIMEOUT_MS = 60_000

export const TUNNEL_CLOSE_SUPERSEDED = 4000
export const TUNNEL_CLOSE_IDLE = 4001
export const TUNNEL_CLOSE_REVOKED = 4003

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
  const streams = new Map<string, { actorId: string; teamId: string }>() // who opened it, in which team
  const channel = holderChannel(userId, deviceId)
  let status: LocalRuntimeStatus | undefined
  let recorded: string | undefined
  let metrics: BoxMetrics | undefined
  let metricsReceivedAt: number | undefined
  const heartbeatMs = deps.heartbeatMs ?? RUNTIME_PRESENCE_HEARTBEAT_MS
  let lastFrameAt = Date.now()
  let lastEchoAt = lastFrameAt
  let presenceAt = 0
  let ended = false
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let unsubscribe = () => {}

  const toStream = (s: string, message: StreamMessage) =>
    deps.bus.publish(streamChannel(s), JSON.stringify(message)).catch(() => {})
  const refreshPresence = () =>
    deps.presence
      .put(userId, deviceId, {
        conn,
        ...(status ? { status } : {}),
        ...(metrics ? { metrics, metricsReceivedAt } : {}),
        seenAt: Date.now(),
      })
      .then((updated) => {
        if (!updated) shut(TUNNEL_CLOSE_IDLE, 'Device presence expired')
      })
      .catch(() => shut(TUNNEL_CLOSE_IDLE, 'Device presence unavailable'))

  // Any frame shows the computer is alive. A pong queued behind data arrives late,
  // so pongs alone would read a busy tunnel as silent.
  const sawFrame = () => {
    lastFrameAt = Date.now()
    if (lastFrameAt - presenceAt < heartbeatMs) return
    presenceAt = lastFrameAt
    void refreshPresence()
  }

  const end = () => {
    if (ended) return
    ended = true
    clearInterval(heartbeat)
    heartbeat = undefined
    unsubscribe()
    for (const s of streams.keys())
      void toStream(s, { t: 'close', reason: 'The computer running this agent disconnected' })
    streams.clear()
    void deps.presence.clear(userId, deviceId, conn).catch(() => {})
  }
  // Every close is logged once with its reason, whichever side ended the tunnel.
  const logClosed = (code: number | undefined, reason: string, extra?: Record<string, unknown>) =>
    logEvent('info', 'agent.local_runtime.tunnel_closed', {
      user_id: userId,
      device_id: deviceId,
      code,
      reason,
      ...extra,
    })
  const shut = (code: number, reason: string) => {
    if (ended) return
    end()
    logClosed(code, reason)
    connection.close(code, reason)
  }

  const openStream = async (message: Extract<HolderMessage, { t: 'open' }>) => {
    // The person acting must still be in the team; the owner's membership is irrelevant.
    const allowed = await deps.isMember(message.actorId, message.teamId).catch(() => false)

    if (ended) return
    if (!allowed) {
      await toStream(message.s, { t: 'close', reason: 'You are not in this team' })

      return
    }
    streams.set(message.s, { actorId: message.actorId, teamId: message.teamId })
    connection.send({
      t: 'open',
      s: message.s,
      purpose: message.purpose,
      provider: message.provider,
      ...(message.instanceId ? { instanceId: message.instanceId } : {}),
    })
  }

  const onHolderMessage = (raw: string) => {
    const message = parseJson<HolderMessage>(raw)

    if (!message || ended) return
    switch (message.t) {
      case 'supersede':
        if (message.previous ? message.previous !== conn : message.conn === conn) return
        shut(TUNNEL_CLOSE_SUPERSEDED, 'Another connection took over this computer')

        return
      case 'revoke':
        shut(TUNNEL_CLOSE_REVOKED, 'This computer was disconnected from Nuphos')

        return
      case 'revoke-actor':
        for (const [s, { actorId, teamId }] of streams)
          if (actorId === message.actorId && (message.teamId ?? teamId) === teamId) {
            streams.delete(s)
            connection.send({ t: 'close', s })
            void toStream(s, {
              t: 'close',
              code: 4003,
              reason: 'Your access to this computer was removed',
            })
          }

        return
      case 'ping':
        if (message.conn === conn) lastEchoAt = Date.now()

        return
      case 'metrics':
        if (message.conn === conn && Number.isFinite(message.leaseMs)) {
          const leaseMs = Math.min(12_000, Math.max(0, message.leaseMs))

          connection.send({ t: 'metrics', leaseMs })
        }

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
  // The computer is pinged directly, so a slow Redis never reads as a dead computer. The bus
  // ping only checks this replica's subscription, which carries every stream, with a long window.
  heartbeat = setInterval(() => {
    if (Date.now() - lastFrameAt > (deps.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS))
      return shut(TUNNEL_CLOSE_IDLE, 'No frames from the computer')
    if (Date.now() - lastEchoAt > (deps.channelTimeoutMs ?? DEFAULT_CHANNEL_TIMEOUT_MS))
      return shut(TUNNEL_CLOSE_IDLE, 'Device channel unavailable')
    connection.send({ t: 'ping' })
    void deps.bus
      .publish(channel, JSON.stringify({ t: 'ping', conn } satisfies HolderMessage))
      .catch(() => {})
  }, heartbeatMs)

  try {
    const previous = await deps.presence.claim(userId, deviceId, conn)

    if (previous)
      await deps.bus.publish(
        channel,
        JSON.stringify({ t: 'supersede', conn, previous } satisfies HolderMessage),
      )
  } catch (error) {
    end()
    throw error
  }
  logEvent('info', 'agent.local_runtime.tunnel_opened', { user_id: userId, device_id: deviceId })
  deps.connectionChanged?.(userId, deviceId)

  return {
    receive(raw) {
      if (ended) return
      const parsed = desktopFrameSchema.safeParse(parseJson(raw))

      if (!parsed.success) {
        // Paths only: the frame is the computer's own data.
        logEvent('warn', 'agent.local_runtime.frame_rejected', {
          user_id: userId,
          device_id: deviceId,
          issues: parsed.error.issues.map((issue) => issue.path.join('.')).join(', '),
        })

        return
      }
      const frame = parsed.data

      switch (frame.t) {
        case 'metrics':
          metrics = frame.metrics
          metricsReceivedAt = Date.now()
          // This write is also the heartbeat, so a 5-second report adds none.
          presenceAt = metricsReceivedAt
          void refreshPresence()
          deps.recordMetrics?.(userId, deviceId, frame.metrics)
          break
        case 'status': {
          const reported = frame.status

          status = reported
          // Only a changed agent list is written, not every status report.
          const agents = JSON.stringify(reportedAgents(reported))

          if (deps.recordAgents && agents !== recorded) {
            const record = deps.recordAgents

            recorded = agents
            // Present first, then noted as seen: a Box never reads offline before it joined.
            void refreshPresence()
              .then(() => record(userId, deviceId, reported))
              .catch(() => {
                recorded = undefined
              })
          }
          break
        }
        case 'pong':
          // Answers the heartbeat; it counts as liveness like every other frame.
          break
        case 'dropped':
          // The old tunnel died on the computer's side; its close never reached us.
          logClosed(frame.code, frame.reason, { closed_by: 'desktop', silent_ms: frame.silentMs })
          break
        case 'opened':
          if (streams.has(frame.s)) void toStream(frame.s, { t: 'opened' })
          break
        case 'data':
          if (streams.has(frame.s)) void toStream(frame.s, { t: 'data', d: frame.d })
          break
        case 'close':
          if (streams.delete(frame.s))
            void toStream(frame.s, {
              t: 'close',
              ...(frame.code === undefined ? {} : { code: frame.code }),
              ...(frame.reason ? { reason: frame.reason } : {}),
            })
      }
      sawFrame()
    },
    closed(code, reason) {
      if (!ended) {
        logClosed(code, reason || 'The connection closed')
        deps.connectionChanged?.(userId, deviceId)
      }
      end()
    },
  }
}
