// Auto Mode persistence.
//
// Two collections, two lifetimes:
//   auto_mode_policy         — per USER, durable across conversations. Holds the
//                              standing allow-rules (proposed + active) and
//                              always-approved exact commands. Only ACTIVE rules
//                              reach the judge; proposed ones await confirmation
//                              in the settings GUI.
//   auto_mode_authorizations — per CONVERSATION, ephemeral. Holds the once/
//                              session grants and the pending authorization
//                              requests awaiting a decision.
import { randomUUID, createHash } from 'node:crypto'

import { db } from '@/lib/db'
import { logError } from '@/lib/observability'

import type { AutoModePolicy, AutoModeRule } from './types'
import type { Collection, ObjectId } from 'mongodb'

export const RULE_DESCRIPTION_MAX_LENGTH = 200

export class RuleValidationError extends Error {
  constructor(public readonly code: 'rule_description_empty' | 'rule_description_too_long') {
    super(code)
    this.name = 'RuleValidationError'
  }
}

/** Trim + validate a rule description. Throws RuleValidationError on empty or
 *  over-length input so callers surface a 400 instead of persisting junk. */
export function sanitizeRuleDescription(description: string): string {
  const trimmed = description.trim().replace(/\s+/g, ' ')

  if (!trimmed) throw new RuleValidationError('rule_description_empty')
  if (trimmed.length > RULE_DESCRIPTION_MAX_LENGTH) {
    throw new RuleValidationError('rule_description_too_long')
  }

  return trimmed
}

export type AutoModePolicyDoc = {
  _id?: ObjectId
  userId: string
  rules: AutoModeRule[]
  approvedCommands: string[]
  createdAt: Date
  updatedAt: Date
}

const POLICY_COLLECTION = 'auto_mode_policy'
const policy = (): Collection<AutoModePolicyDoc> =>
  db().collection<AutoModePolicyDoc>(POLICY_COLLECTION)

export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ')
}
export function hashCommand(command: string): string {
  return createHash('sha256').update(normalizeCommand(command)).digest('hex').slice(0, 32)
}

export async function setupAutoModeIndexes(): Promise<void> {
  try {
    await policy().createIndex({ userId: 1 }, { unique: true, background: true })
    await authorizations().createIndex(
      { conversationId: 1, userId: 1 },
      { unique: true, background: true },
    )
    // Session grants are ephemeral — expire the doc a week after last touch.
    await authorizations().createIndex(
      { updatedAt: 1 },
      { expireAfterSeconds: 7 * 24 * 3600, background: true },
    )
  } catch (err) {
    logError('agent.auto_mode.indexes_create_failed', err)
  }
}

// ── Session approvals (per-conversation) ────────────────────────────────
//
// "Approve for session" grants. Exact-matched by the decision engine and fed
// to the judge so same-effect retries stop re-prompting within a conversation.

type AutoModeAuthorizationsDoc = {
  _id?: ObjectId
  conversationId: string
  userId: string
  approvedCommands: string[]
  /** Full Access: the user disarmed the authorization gate for this
   *  conversation — every governed command auto-allows (layer `bypass`). */
  bypass?: boolean
  createdAt: Date
  updatedAt: Date
}

const AUTHORIZATIONS_COLLECTION = 'auto_mode_authorizations'
const authorizations = (): Collection<AutoModeAuthorizationsDoc> =>
  db().collection<AutoModeAuthorizationsDoc>(AUTHORIZATIONS_COLLECTION)

const MAX_SESSION_APPROVALS_STORED = 50

export async function addSessionApproval(
  conversationId: string,
  userId: string,
  command: string,
): Promise<void> {
  const now = new Date()

  await authorizations().updateOne(
    { conversationId, userId },
    {
      $setOnInsert: { conversationId, userId, createdAt: now },
      $set: { updatedAt: now },
      $push: {
        approvedCommands: {
          $each: [normalizeCommand(command)],
          $slice: -MAX_SESSION_APPROVALS_STORED,
        },
      },
    },
    { upsert: true },
  )
}

/** Session-approved commands for a conversation, oldest first. Scoped by
 *  userId so a grant never leaks across a conversation-id collision. */
export async function listSessionApprovals(
  conversationId: string,
  userId: string,
): Promise<string[]> {
  const doc = await authorizations().findOne(
    { conversationId, userId },
    { projection: { approvedCommands: 1 } },
  )

  return doc?.approvedCommands ?? []
}

export type SessionAuthState = { approvedCommands: string[]; bypass: boolean }

/** Session approvals + bypass flag in one read — the per-tool-call hot path. */
export async function getSessionAuthState(
  conversationId: string,
  userId: string,
): Promise<SessionAuthState> {
  const doc = await authorizations().findOne(
    { conversationId, userId },
    { projection: { approvedCommands: 1, bypass: 1 } },
  )

  return { approvedCommands: doc?.approvedCommands ?? [], bypass: doc?.bypass === true }
}

/** First-turn preference: never overwrite an explicit toggle or a retry's state. */
export async function initializeSessionBypass(
  conversationId: string,
  userId: string,
  enabled: boolean,
): Promise<void> {
  const now = new Date()

  await authorizations().updateOne(
    { conversationId, userId },
    {
      $setOnInsert: {
        conversationId,
        userId,
        approvedCommands: [],
        createdAt: now,
        updatedAt: now,
        bypass: enabled,
      },
    },
    { upsert: true },
  )
}

export async function setSessionBypass(
  conversationId: string,
  userId: string,
  enabled: boolean,
): Promise<void> {
  const now = new Date()

  await authorizations().updateOne(
    { conversationId, userId },
    {
      $setOnInsert: { conversationId, userId, approvedCommands: [], createdAt: now },
      $set: { bypass: enabled, updatedAt: now },
    },
    { upsert: true },
  )
}

export async function getSessionBypass(conversationId: string, userId: string): Promise<boolean> {
  const doc = await authorizations().findOne(
    { conversationId, userId },
    { projection: { bypass: 1 } },
  )

  return doc?.bypass === true
}

// ── Policy (per-user) ────────────────────────────────────────────────────

async function ensurePolicyDoc(userId: string): Promise<AutoModePolicyDoc> {
  const now = new Date()

  await policy().updateOne(
    { userId },
    {
      $setOnInsert: { userId, rules: [], approvedCommands: [], createdAt: now },
      $set: { updatedAt: now },
    },
    { upsert: true },
  )

  return (await policy().findOne({ userId })) as AutoModePolicyDoc
}

/** The judge-facing policy: ACTIVE rules only + always-approved commands. */
export async function getEffectivePolicy(userId: string): Promise<AutoModePolicy> {
  const doc = await policy().findOne({ userId }, { projection: { rules: 1, approvedCommands: 1 } })

  return {
    rules: (doc?.rules ?? []).filter((r) => r.status === 'active'),
    approvedCommands: doc?.approvedCommands ?? [],
  }
}

/** All rules (proposed + active) for the settings list. */
export async function listRules(userId: string): Promise<AutoModeRule[]> {
  const doc = await policy().findOne({ userId }, { projection: { rules: 1 } })

  return doc?.rules ?? []
}

/** Add a rule. `status` chooses proposed (agent-staged) vs active (user-added). */
export async function addRule(
  userId: string,
  description: string,
  createdBy: string,
  status: 'proposed' | 'active',
  proposedFromConversationId?: string,
): Promise<AutoModeRule> {
  await ensurePolicyDoc(userId)
  const rule: AutoModeRule = {
    id: randomUUID(),
    description: sanitizeRuleDescription(description),
    status,
    createdBy,
    createdAt: new Date(),
    ...(proposedFromConversationId ? { proposedFromConversationId } : {}),
  }

  await policy().updateOne({ userId }, { $push: { rules: rule }, $set: { updatedAt: new Date() } })

  return rule
}

/** Confirm a proposed rule → active (user action in the GUI). */
export async function activateRule(userId: string, ruleId: string): Promise<boolean> {
  const res = await policy().updateOne(
    { userId, 'rules.id': ruleId },
    { $set: { 'rules.$.status': 'active', updatedAt: new Date() } },
  )

  return res.modifiedCount > 0
}

export async function removeRule(userId: string, ruleId: string): Promise<void> {
  await policy().updateOne(
    { userId },
    { $pull: { rules: { id: ruleId } }, $set: { updatedAt: new Date() } },
  )
}

async function addApprovedCommand(userId: string, command: string): Promise<void> {
  await ensurePolicyDoc(userId)
  await policy().updateOne(
    { userId },
    { $addToSet: { approvedCommands: normalizeCommand(command) }, $set: { updatedAt: new Date() } },
  )
}
