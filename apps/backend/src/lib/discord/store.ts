import { randomUUID } from 'node:crypto'

import { db } from '@/lib/db'

import type { Collection, ObjectId } from 'mongodb'

export type DiscordInstallation = {
  /** Transaction fence for approval claims versus revocation. */
  discordApprovalFence?: string
  _id?: ObjectId
  guildId: string
  guildName: string
  teamId: string
  installerDiscordUserId: string
  installerNuphosUserId: string
  generation: number
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

export type DiscordPendingOAuth = {
  _id: string
  operation: 'install' | 'link'
  teamId: string
  requesterUserId: string
  expectedGuildId?: string
  expiresAt: Date
}

export type DiscordChannelMapping = {
  /** Transaction fence for approval claims versus revocation. */
  discordApprovalFence?: string
  guildId: string
  channelId: string
  teamId: string
  enabled: boolean
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

export type DiscordUserMapping = {
  /** Transaction fence for approval claims versus revocation. */
  discordApprovalFence?: string
  guildId: string
  discordUserId: string
  teamId: string
  nuphosUserId: string
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

export type DiscordAgentThread = {
  guildId: string
  parentChannelId: string
  threadChannelId: string
  rootMessageId: string
  teamId: string
  agentUserId: string
  sessionId: string
  createdByDiscordUserId: string
  generation: number
  createdAt: Date
  lastActiveAt: Date
}

export type DiscordProcessedEvent = {
  eventId: string
  status: 'processing' | 'completed' | 'failed' | 'ignored'
  payload?: unknown
  processingExpiresAt?: Date
  error?: string
  createdAt: Date
  updatedAt: Date
}

export type DiscordDecision = {
  _id: string
  kind: 'agent-permission'
  ref: string
  guildId: string
  channelId: string
  parentChannelId: string
  installationGeneration: number
  teamId: string
  sessionId: string
  actorUserId: string
  status: 'pending' | 'approved' | 'rejected'
  createdAt: Date
  expiresAt: Date
  decidedAt?: Date
}

export const discordInstallations = (): Collection<DiscordInstallation> =>
  db().collection('discord_installations')
export const discordPendingOAuth = (): Collection<DiscordPendingOAuth> =>
  db().collection('discord_pending_oauth')
export const discordChannelMappings = (): Collection<DiscordChannelMapping> =>
  db().collection('discord_channel_mappings')
export const discordUserMappings = (): Collection<DiscordUserMapping> =>
  db().collection('discord_user_mappings')
export const discordAgentThreads = (): Collection<DiscordAgentThread> =>
  db().collection('discord_agent_threads')
export const discordProcessedEvents = (): Collection<DiscordProcessedEvent> =>
  db().collection('discord_events')
export const discordDecisions = (): Collection<DiscordDecision> =>
  db().collection('discord_decisions')
export const discordGatewayLeases = (): Collection<{
  _id: 'gateway'
  ownerId: string
  expiresAt: Date
}> => db().collection('discord_gateway_leases')

export async function setupDiscordIndexes(): Promise<void> {
  await Promise.all([
    db()
      .collection('discord_session_messages')
      .createIndex({ teamId: 1, sessionId: 1, guildId: 1, generation: 1, recordedAt: -1 }),
    discordInstallations().createIndex({ guildId: 1 }, { unique: true, background: true }),
    discordInstallations().createIndex({ teamId: 1 }, { unique: true, background: true }),
    discordPendingOAuth().createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'discord_pending_oauth_ttl' },
    ),
    discordChannelMappings().createIndex(
      { guildId: 1, channelId: 1 },
      { unique: true, background: true },
    ),
    discordUserMappings().createIndex(
      { guildId: 1, discordUserId: 1 },
      { unique: true, background: true },
    ),
    discordUserMappings().createIndex(
      { guildId: 1, nuphosUserId: 1 },
      { unique: true, background: true },
    ),
    discordAgentThreads().createIndex(
      { guildId: 1, threadChannelId: 1 },
      { unique: true, background: true },
    ),
    discordAgentThreads().createIndex({ sessionId: 1 }, { unique: true, background: true }),
    discordProcessedEvents().createIndex({ eventId: 1 }, { unique: true, background: true }),
    discordProcessedEvents().createIndex(
      { status: 1, processingExpiresAt: 1 },
      { background: true },
    ),
    discordProcessedEvents().createIndex(
      { createdAt: 1 },
      { expireAfterSeconds: 7 * 24 * 60 * 60, name: 'discord_events_ttl' },
    ),
    discordDecisions().createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'discord_decisions_ttl' },
    ),
  ])
}

export async function claimDiscordEvent(eventId: string, payload?: unknown): Promise<boolean> {
  const now = new Date()
  const processingExpiresAt = new Date(now.getTime() + 5 * 60_000)

  try {
    await discordProcessedEvents().insertOne({
      eventId,
      status: 'processing',
      ...(payload === undefined ? {} : { payload }),
      processingExpiresAt,
      createdAt: now,
      updatedAt: now,
    })

    return true
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      const reclaimed = await discordProcessedEvents().findOneAndUpdate(
        { eventId, status: 'processing', processingExpiresAt: { $lt: now } },
        {
          $set: {
            ...(payload === undefined ? {} : { payload }),
            processingExpiresAt,
            updatedAt: now,
          },
        },
        { returnDocument: 'after' },
      )

      return reclaimed !== null
    }
    throw err
  }
}

export async function refreshDiscordEventClaim(eventId: string): Promise<void> {
  await discordProcessedEvents().updateOne(
    { eventId, status: 'processing' },
    { $set: { processingExpiresAt: new Date(Date.now() + 5 * 60_000), updatedAt: new Date() } },
  )
}

export async function markDiscordEvent(
  eventId: string,
  status: DiscordProcessedEvent['status'],
  error?: string,
): Promise<void> {
  await discordProcessedEvents().updateOne(
    { eventId },
    {
      $set: {
        status,
        updatedAt: new Date(),
        ...(error ? { error: error.slice(0, 1000) } : {}),
      },
      $unset: { processingExpiresAt: '', payload: '', ...(!error ? { error: '' } : {}) },
    },
  )
}

export async function getOrCreateDiscordThread(data: {
  guildId: string
  parentChannelId: string
  threadChannelId: string
  rootMessageId: string
  teamId: string
  agentUserId: string
  createdByDiscordUserId: string
  generation: number
}): Promise<DiscordAgentThread> {
  const now = new Date()
  const thread = await discordAgentThreads().findOneAndUpdate(
    { guildId: data.guildId, threadChannelId: data.threadChannelId },
    {
      $setOnInsert: {
        ...data,
        sessionId: randomUUID(),
        createdAt: now,
      },
      $set: { lastActiveAt: now },
    },
    { upsert: true, returnDocument: 'after' },
  )

  if (!thread) throw new Error('Failed to create Discord agent thread')

  return thread
}
