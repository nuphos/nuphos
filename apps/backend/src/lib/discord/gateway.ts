import { randomUUID } from 'node:crypto'

import { config } from '@/config'
import { registerDiscordCommands } from '@/lib/discord/api'
import { discordGatewayLeases } from '@/lib/discord/store'
import { logError, logEvent } from '@/lib/observability'
import { handleDiscordGatewayInteraction } from '@/routes/discord/interactions'
import { handleDiscordMention } from '@/routes/discord/mention'
import { recoverDiscordMentions } from '@/routes/discord/message-recovery'

import type { DiscordInteraction } from '@/routes/discord/interactions'

type GatewayPayload = { op: number; d?: unknown; s?: number | null; t?: string | null }

let socket: WebSocket | null = null
let heartbeat: ReturnType<typeof setInterval> | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let leaseTimer: ReturnType<typeof setInterval> | null = null
let standbyTimer: ReturnType<typeof setInterval> | null = null
let recoveryTimer: ReturnType<typeof setInterval> | null = null
let stopping = false
let commandsRegistered = false
let sequence: number | null = null
let sessionId: string | null = null
let resumeUrl: string | null = null
let botUserId: string | null = null
let awaitingHeartbeatAck = false
const leaseOwnerId = randomUUID()
const LEASE_MS = 30_000

function clearTimers(): void {
  if (heartbeat) clearInterval(heartbeat)
  if (reconnectTimer) clearTimeout(reconnectTimer)
  heartbeat = null
  reconnectTimer = null
}

async function acquireLease(): Promise<boolean> {
  const now = new Date()

  try {
    const lease = await discordGatewayLeases().findOneAndUpdate(
      {
        _id: 'gateway',
        $or: [{ ownerId: leaseOwnerId }, { expiresAt: { $lte: now } }],
      },
      {
        $set: { ownerId: leaseOwnerId, expiresAt: new Date(now.getTime() + LEASE_MS) },
      },
      { upsert: true, returnDocument: 'after' },
    )

    return lease?.ownerId === leaseOwnerId
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false
    throw err
  }
}

async function renewLease(): Promise<void> {
  const result = await discordGatewayLeases().updateOne(
    { _id: 'gateway', ownerId: leaseOwnerId },
    { $set: { expiresAt: new Date(Date.now() + LEASE_MS) } },
  )

  if (result.matchedCount === 0) {
    logEvent('warn', 'discord.gateway.lease_lost')
    stopping = true
    socket?.close(1000, 'Gateway lease lost')
  }
}

function send(payload: GatewayPayload): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload))
}

function scheduleReconnect(delay = 1000): void {
  clearTimers()
  if (stopping) return
  reconnectTimer = setTimeout(() => void connect().catch(onConnectError), delay)
}

function onConnectError(err: unknown): void {
  logError('discord.gateway.connect_error', err)
  scheduleReconnect(5000)
}

async function connect(): Promise<void> {
  const token = config.discord.botToken

  if (!token || stopping) return
  let gatewayUrl = resumeUrl

  if (!gatewayUrl) {
    const response = await fetch('https://discord.com/api/v10/gateway/bot', {
      headers: { Authorization: `Bot ${token}` },
    })

    if (!response.ok) throw new Error(`Discord Gateway discovery failed (${response.status})`)
    gatewayUrl = ((await response.json()) as { url: string }).url
  }
  socket = new WebSocket(`${gatewayUrl}?v=10&encoding=json`)
  socket.addEventListener('message', (event) => {
    void handlePayload(JSON.parse(String(event.data)) as GatewayPayload).catch((err) => {
      logError('discord.gateway.payload_error', err)
    })
  })
  socket.addEventListener('close', (event) => {
    logEvent('warn', 'discord.gateway.closed', { code: event.code })
    socket = null
    awaitingHeartbeatAck = false
    if ([4004, 4010, 4011, 4012, 4013, 4014].includes(event.code)) {
      stopping = true
      logEvent('error', 'discord.gateway.fatal_close', { code: event.code })

      return
    }
    scheduleReconnect(event.code === 4008 ? 5000 : 1000)
  })
  socket.addEventListener('error', () => socket?.close())
}

async function handlePayload(payload: GatewayPayload): Promise<void> {
  if (typeof payload.s === 'number') sequence = payload.s
  if (payload.op === 10) {
    const interval = (payload.d as { heartbeat_interval: number }).heartbeat_interval

    heartbeat = setInterval(() => {
      if (awaitingHeartbeatAck) {
        socket?.close(4000, 'Heartbeat acknowledgement timed out')

        return
      }
      awaitingHeartbeatAck = true
      send({ op: 1, d: sequence })
    }, interval)
    if (sessionId && sequence !== null) {
      send({ op: 6, d: { token: config.discord.botToken, session_id: sessionId, seq: sequence } })
    } else {
      send({
        op: 2,
        d: {
          token: config.discord.botToken,
          intents: 513 | (1 << 15),
          properties: { os: process.platform, browser: 'nuphos', device: 'nuphos' },
        },
      })
    }

    return
  }
  if (payload.op === 7) {
    socket?.close()

    return
  }
  if (payload.op === 11) {
    awaitingHeartbeatAck = false

    return
  }
  if (payload.op === 9) {
    const resumable = payload.d === true

    if (!resumable) {
      sequence = null
      sessionId = null
      resumeUrl = null
    }
    socket?.close()

    return
  }
  if (payload.op !== 0) return
  if (payload.t === 'READY') {
    const ready = payload.d as {
      session_id: string
      resume_gateway_url: string
      user: { id: string }
    }

    sessionId = ready.session_id
    resumeUrl = ready.resume_gateway_url
    botUserId = ready.user.id
    logEvent('info', 'discord.gateway.ready', { bot_user_id: botUserId })
    void recoverDiscordMentions(botUserId).catch((err: unknown) => {
      logError('discord.gateway.recovery_error', err)
    })
    if (!recoveryTimer) {
      recoveryTimer = setInterval(() => {
        if (!botUserId) return
        void recoverDiscordMentions(botUserId).catch((err: unknown) => {
          logError('discord.gateway.recovery_error', err)
        })
      }, 60_000)
    }

    return
  }
  if (payload.t === 'INTERACTION_CREATE') {
    await handleDiscordGatewayInteraction(payload.d as DiscordInteraction)

    return
  }
  if (payload.t === 'MESSAGE_CREATE' && botUserId) {
    await handleDiscordMention(payload.d as Parameters<typeof handleDiscordMention>[0], botUserId)
  }
}

async function assumeGatewayOwnership(): Promise<boolean> {
  if (!(await acquireLease())) return false
  if (standbyTimer) clearInterval(standbyTimer)
  if (recoveryTimer) clearInterval(recoveryTimer)
  standbyTimer = null
  recoveryTimer = null
  leaseTimer = setInterval(() => {
    void renewLease().catch((err: unknown) => {
      logError('discord.gateway.lease_renew_error', err)
    })
  }, LEASE_MS / 3)
  if (!commandsRegistered && config.discord.clientId) {
    try {
      await registerDiscordCommands()
      commandsRegistered = true
      logEvent('info', 'discord.commands.ready')
    } catch (err) {
      logError('discord.commands.registration_error', err)
    }
  }
  void connect().catch(onConnectError)

  return true
}

export async function initDiscordGateway(): Promise<boolean> {
  if (!config.discord.botToken) return false
  stopping = false
  if (!(await assumeGatewayOwnership())) {
    standbyTimer = setInterval(() => {
      void assumeGatewayOwnership().catch((err: unknown) => {
        logError('discord.gateway.standby_error', err)
      })
    }, LEASE_MS / 3)
  }

  return true
}

export function shutdownDiscordGateway(): void {
  stopping = true
  clearTimers()
  if (leaseTimer) clearInterval(leaseTimer)
  if (standbyTimer) clearInterval(standbyTimer)
  leaseTimer = null
  standbyTimer = null
  socket?.close(1000, 'Server shutdown')
  socket = null
  void discordGatewayLeases().deleteOne({ _id: 'gateway', ownerId: leaseOwnerId })
}
