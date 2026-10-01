import { db } from '@/lib/db'

import type { Collection, ObjectId } from 'mongodb'

// A Lark tenant is identified by its tenant_key (stable per Lark org). All bridge
// collections are keyed by (appId, ...) — the tenant_key is the trust anchor
// the way the Slack workspace id is for Slack.
export type LarkChatMapping = {
  _id?: ObjectId
  appId: string
  chatId: string
  teamId: string
  // Best-effort group display name (from im/v1/chats), refreshed on link. For UI
  // only — the chatId is the identity.
  name?: string
  enabled: boolean
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

export type LarkUserMapping = {
  _id?: ObjectId
  appId: string
  larkOpenId: string
  teamId: string
  nuphosUserId: string
  enabled: boolean
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

// One agent session per Lark thread. threadId is the thread root message id
// (group @mention threads) or the chat id (1:1 DMs, which have no threads).
export type LarkAgentThread = {
  _id?: ObjectId
  appId: string
  chatId: string
  threadId: string
  teamId: string
  agentUserId: string
  sessionId: string
  createdByLarkOpenId: string
  lastLarkEventId?: string
  createdAt: Date
  lastActiveAt: Date
}

export type LarkProcessedEvent = {
  _id?: ObjectId
  eventId: string
  appId?: string
  chatId?: string
  threadId?: string
  status: 'processing' | 'completed' | 'failed' | 'ignored'
  processingExpiresAt?: Date
  error?: string
  createdAt: Date
  updatedAt: Date
}

export type LarkReplyFeedback = {
  _id?: ObjectId
  appId: string
  chatId: string
  messageId: string
  larkOpenId: string
  sessionId?: string
  verdict: 'up' | 'down'
  createdAt: Date
  updatedAt: Date
}

// A short, single-use code a member generates in the desktop app and DMs to the
// bot to link their own Lark account — the only self-serve path, since a custom
// app's tenant token can't read a sender's email to auto-map them.
export type LarkPairCode = {
  _id?: ObjectId
  code: string
  teamId: string
  nuphosUserId: string
  createdAt: Date
  expiresAt: Date
}

const CHAT_MAPPINGS = 'lark_chat_mappings'
const USER_MAPPINGS = 'lark_user_mappings'
const AGENT_THREADS = 'lark_agent_threads'
const PROCESSED_EVENTS = 'lark_agent_events'
const REPLY_FEEDBACK = 'lark_reply_feedback'
const PAIR_CODES = 'lark_pair_codes'

export const larkChatMappings = (): Collection<LarkChatMapping> =>
  db().collection<LarkChatMapping>(CHAT_MAPPINGS)
export const larkUserMappings = (): Collection<LarkUserMapping> =>
  db().collection<LarkUserMapping>(USER_MAPPINGS)
export const larkAgentThreads = (): Collection<LarkAgentThread> =>
  db().collection<LarkAgentThread>(AGENT_THREADS)
export const larkProcessedEvents = (): Collection<LarkProcessedEvent> =>
  db().collection<LarkProcessedEvent>(PROCESSED_EVENTS)
export const larkReplyFeedback = (): Collection<LarkReplyFeedback> =>
  db().collection<LarkReplyFeedback>(REPLY_FEEDBACK)
export const larkPairCodes = (): Collection<LarkPairCode> =>
  db().collection<LarkPairCode>(PAIR_CODES)

export async function setupLarkAgentIndexes(): Promise<void> {
  await larkChatMappings().createIndex({ appId: 1, chatId: 1 }, { unique: true, background: true })
  await larkChatMappings().createIndex({ teamId: 1, updatedAt: -1 }, { background: true })
  await larkUserMappings().createIndex(
    { appId: 1, teamId: 1, larkOpenId: 1 },
    { unique: true, background: true },
  )
  await larkUserMappings().createIndex({ teamId: 1, updatedAt: -1 }, { background: true })
  await larkUserMappings().createIndex({ nuphosUserId: 1, updatedAt: -1 }, { background: true })
  await larkAgentThreads().createIndex(
    { appId: 1, chatId: 1, threadId: 1 },
    { unique: true, background: true },
  )
  await larkAgentThreads().createIndex({ sessionId: 1 }, { unique: true, background: true })
  await larkAgentThreads().createIndex({ teamId: 1, lastActiveAt: -1 }, { background: true })
  await larkProcessedEvents().createIndex({ eventId: 1 }, { unique: true, background: true })
  // Replay protection only needs to outlive redelivery windows; expire the
  // idempotency ledger after 7 days so it doesn't grow unbounded.
  await larkProcessedEvents().createIndex(
    { createdAt: 1 },
    { expireAfterSeconds: 7 * 24 * 60 * 60, name: 'lark_agent_events_ttl' },
  )
  await larkProcessedEvents().createIndex(
    { status: 1, processingExpiresAt: 1 },
    { background: true },
  )
  await larkReplyFeedback().createIndex(
    { appId: 1, chatId: 1, messageId: 1, larkOpenId: 1 },
    { unique: true, background: true },
  )
  await larkReplyFeedback().createIndex({ sessionId: 1, updatedAt: -1 }, { background: true })
  await larkPairCodes().createIndex({ code: 1 }, { unique: true, background: true })
  await larkPairCodes().createIndex({ teamId: 1, nuphosUserId: 1 }, { background: true })
  // Mongo reaps expired codes on its own once past expiresAt.
  await larkPairCodes().createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: 'lark_pair_codes_ttl' },
  )
}
