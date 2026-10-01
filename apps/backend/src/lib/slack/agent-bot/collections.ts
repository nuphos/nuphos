import { db } from '@/lib/db'

import type { Collection, ObjectId } from 'mongodb'

export type SlackChannelMapping = {
  _id?: ObjectId
  slackWorkspaceId: string
  slackChannelId: string
  teamId: string
  agentUserId?: string
  enabled: boolean
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

export type SlackUserMapping = {
  _id?: ObjectId
  slackWorkspaceId: string
  slackUserId: string
  teamId: string
  nuphosUserId: string
  enabled: boolean
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

// One line of a thread's rolling transcript. Recorded for EVERY message the
// bot observes in a registered thread — including the ones it decides not to
// answer — because those are exactly the messages the addressing judge needs
// to tell "asking me" from "two teammates talking".
export type SlackThreadMessageRecord = {
  ts: string
  authorName: string
  text: string
  fromBot?: boolean
}

// How many messages of rolling thread history each row keeps. Per-message
// length is bounded too (clipTranscriptText in thread-addressing-core), so a
// busy incident thread cannot grow a row without limit.
export const SLACK_THREAD_WINDOW = 30

export type SlackAgentThread = {
  _id?: ObjectId
  slackWorkspaceId: string
  slackChannelId: string
  slackThreadTs: string
  teamId: string
  agentUserId: string
  sessionId: string
  createdBySlackUserId: string
  // Older rows predate this field and are Slack-originated by definition.
  // Proactive notification rows bind an already-running desktop/trigger
  // conversation to the root message posted by slack_post. User-pickup rows
  // bind a desktop conversation to a DM root the user explicitly asked for
  // ("pick up this session in Slack"), so they carry no reply gate.
  origin?: 'slack' | 'agent_notification' | 'user_pickup'
  lastSlackEventId?: string
  // Absent on rows written before addressing was judged; an empty window just
  // means the judge decides on the incoming message alone.
  recentMessages?: SlackThreadMessageRecord[]
  // What the bot posted here, in full. recentMessages clips every entry for
  // the judge, which is far too little to answer a question about a
  // report — so a forked notification thread keeps the untruncated text and
  // hands it to its first turn. Only set when the thread was bound to a session
  // created for it, which therefore has no transcript of its own to read.
  notificationContext?: string
  createdAt: Date
  lastActiveAt: Date
}

export type SlackAgentThreadSummary = Pick<SlackAgentThread, 'sessionId' | 'origin'>

// What the user was looking at in Slack while an assistant thread was open.
// assistant_thread_started / assistant_thread_context_changed push it; the
// message handler reads it so "this channel" style questions resolve without a
// follow-up (message.im payloads carry no viewing context of their own).
export type SlackAssistantThreadContext = {
  _id?: ObjectId
  slackWorkspaceId: string
  slackChannelId: string
  slackThreadTs: string
  contextChannelId?: string
  updatedAt: Date
}

export type SlackProcessedEvent = {
  _id?: ObjectId
  eventId: string
  slackWorkspaceId?: string
  slackChannelId?: string
  slackThreadTs?: string
  eventTs?: string
  status: 'processing' | 'completed' | 'failed' | 'ignored'
  processingExpiresAt?: Date
  error?: string
  createdAt: Date
  updatedAt: Date
}

export type SlackReplyFeedback = {
  _id?: ObjectId
  slackWorkspaceId: string
  slackChannelId: string
  // ts of the finalized agent reply the feedback buttons were attached to.
  messageTs: string
  slackUserId: string
  // Agent session the reply came from (carried in the button value).
  sessionId?: string
  verdict: 'up' | 'down'
  createdAt: Date
  updatedAt: Date
}

// One row per thread-addressing judgement — the judge's whole context (full
// prompt included) and what it decided. slackProcessedEvents only says a reply
// ended 'ignored'; auditing a misjudged reply and iterating on the prompt needs
// the exact input the model saw, which otherwise lives only in Braintrust.
export type SlackAddressingVerdict = {
  _id?: ObjectId
  /** `live:<eventId>` or `braintrust:<spanId>` — one unique key across both
   *  sources, since backfilled spans have no Slack event id. */
  dedupeKey: string
  source: 'live' | 'braintrust_backfill'
  eventId?: string
  braintrustSpanId?: string
  slackWorkspaceId?: string
  slackChannelId?: string
  slackThreadTs?: string
  sessionId?: string
  teamId?: string
  /** null = fail-open: the judge timed out, errored, or answered unparseably,
   *  and the reply was answered anyway. */
  addressed: boolean | null
  failOpen: boolean
  reason?: string
  rawOutput?: string
  pendingDecision: boolean
  alertThread: boolean
  senderName?: string
  incomingText: string
  /** The exact prompt the judge saw, verbatim. */
  prompt: string
  modelId: string
  /** THREAD_ADDRESSING_PROMPT_VERSION at judgement time. Absent on rows
   *  recorded before versioning (including Braintrust backfills). */
  promptVersion?: number
  createdAt: Date
}

const CHANNEL_MAPPINGS = 'slack_channel_mappings'
const USER_MAPPINGS = 'slack_user_mappings'
const AGENT_THREADS = 'slack_agent_threads'
const PROCESSED_EVENTS = 'slack_agent_events'
const REPLY_FEEDBACK = 'slack_reply_feedback'
const ASSISTANT_THREAD_CONTEXT = 'slack_assistant_thread_context'
const ADDRESSING_VERDICTS = 'slack_addressing_verdicts'

export const slackChannelMappings = (): Collection<SlackChannelMapping> =>
  db().collection<SlackChannelMapping>(CHANNEL_MAPPINGS)

export const slackUserMappings = (): Collection<SlackUserMapping> =>
  db().collection<SlackUserMapping>(USER_MAPPINGS)

export const slackAgentThreads = (): Collection<SlackAgentThread> =>
  db().collection<SlackAgentThread>(AGENT_THREADS)

export const slackProcessedEvents = (): Collection<SlackProcessedEvent> =>
  db().collection<SlackProcessedEvent>(PROCESSED_EVENTS)

export const slackReplyFeedback = (): Collection<SlackReplyFeedback> =>
  db().collection<SlackReplyFeedback>(REPLY_FEEDBACK)

export const slackAssistantThreadContexts = (): Collection<SlackAssistantThreadContext> =>
  db().collection<SlackAssistantThreadContext>(ASSISTANT_THREAD_CONTEXT)

export const slackAddressingVerdicts = (): Collection<SlackAddressingVerdict> =>
  db().collection<SlackAddressingVerdict>(ADDRESSING_VERDICTS)

export function isDuplicateKeyError(err: unknown): boolean {
  return (err as { code?: number })?.code === 11000
}
