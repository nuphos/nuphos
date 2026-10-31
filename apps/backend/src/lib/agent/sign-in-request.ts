// Someone who cannot sign an agent in asks the people who can. The ask lives on
// the conversation, so their Inbox lists it, and the message it holds runs as
// soon as anyone signs the agent in.
import { canReply, conversationAccess } from '@/lib/agent/db/access'
import { agentConversations } from '@/lib/agent/db/shared'
import { parseLocalRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { consumePairQuota } from '@/lib/download-handoff-rate-limit'
import { AppError } from '@/lib/errors'
import { getTeamMembers } from '@/lib/identity'
import { logEvent } from '@/lib/observability'
import { notifyNudge } from '@/lib/push/notify'

import { getConversationBySessionId } from './db'
import { PENDING_TTL_SEC } from './pending-messages'

import type { AgentConversation } from './db'
import type { DownloadHandoffRateLimitResult } from '@/lib/download-handoff-rate-limit'
import type { NuphosTeamMember, NuphosTeamRole } from '@/lib/identity/types'

/** Who was asked to act on which agent, for whom. Names are for display only. */
export type SignInRequest = {
  runtimeId: string
  requesterId: string
  requesterName: string
  askedUserIds: string[]
  askedName: string
  askedAt: Date
  notifiedAt?: Date
}

/** A sign-in the requester's messages wait for. */
export type NudgeKind = 'signInRequest'

export type NudgeConversation = AgentConversation & Partial<Record<NudgeKind, SignInRequest>>

type Member = Pick<NuphosTeamMember, 'id' | 'name' | 'role' | 'joinedAt' | 'removedAt'>

/** A repeat inside this window is stored again but notifies nobody. */
export const NOTIFY_REPEAT_MS = 30 * 60_000
export const NUDGES_PER_HOUR = 10
const NUDGES_PER_DAY = 30

/** An ask holds messages as long as the queue keeps them; after that a send runs as usual. */
export const ASK_OPEN_MS = PENDING_TTL_SEC * 1000

/** The ask holding this conversation's sends: only one about the agent it runs on now. */
export function openSignInRequest(
  conversation: Partial<NudgeConversation> | null | undefined,
  now = Date.now(),
): SignInRequest | null {
  const ask = conversation?.signInRequest

  if (!ask || ask.runtimeId !== conversation?.runtimeId) return null

  return now - new Date(ask.askedAt).getTime() < ASK_OPEN_MS ? ask : null
}

const lapses = new Map<string, ReturnType<typeof setTimeout>>()

/** An ask that lapses unanswered lets what it held run; one timer per conversation. */
export function releaseWhenAskLapses(
  key: string,
  ask: SignInRequest,
  release: () => void,
  now = Date.now(),
  schedule: (work: () => void, delayMs: number) => ReturnType<typeof setTimeout> = (work, ms) =>
    setTimeout(work, ms).unref(),
): void {
  if (lapses.has(key)) return
  const delayMs = Math.max(new Date(ask.askedAt).getTime() + ASK_OPEN_MS - now, 0) + 1_000

  lapses.set(
    key,
    schedule(() => {
      lapses.delete(key)
      release()
    }, delayMs),
  )
}

/**
 * Mirrors requireLoginRole: a member's own computer or Box is signed in by that
 * member, a team agent by its administrators. Null when the requester can do it.
 */
export function signInRecipients(
  runtimeId: string,
  requester: { id: string; role: NuphosTeamRole },
  members: Member[],
): Member[] | null {
  const owner = parseLocalRuntimeId(runtimeId)?.userId

  if (owner ? owner === requester.id : requester.role === 'ADMINISTRATOR') return null

  return members
    .filter((member) => !member.removedAt && member.id !== requester.id)
    .filter((member) => (owner ? member.id === owner : member.role === 'ADMINISTRATOR'))
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
}

export type NudgePush = { sessionId: string; teamId: string; title: string; body: string }

export type NudgeDeps = {
  conversation: (sessionId: string) => Promise<NudgeConversation | null>
  members: (teamId: string) => Promise<Member[]>
  /** What the agent reports about its own sign-in; undefined when it cannot say. */
  signedIn: (teamId: string, runtimeId: string, userId: string) => Promise<boolean | undefined>
  quota: (requesterId: string) => Promise<DownloadHandoffRateLimitResult>
  /**
   * Given `since`, replaces the record unless this ask was notified after it;
   * otherwise updates it and keeps the time it was last notified.
   */
  store: (
    conversation: NudgeConversation,
    kind: NudgeKind,
    record: SignInRequest,
    since?: Date,
  ) => Promise<boolean>
  notify: (userIds: string[], push: NudgePush) => void
  now: () => number
}

export const nudgeDeps: NudgeDeps = {
  conversation: (sessionId) => getConversationBySessionId(sessionId),
  members: (teamId) => getTeamMembers(teamId),
  // Loaded on use: the runtime status modules reach the whole runtime graph.
  signedIn: async (teamId, runtimeId, userId) => {
    try {
      const [{ localRuntimeStatus }, { requireRuntimeInstance }, { runtimeStatusWithUpdate }] =
        await Promise.all([
          import('@/lib/claude-code-preview/local-runtime-catalog'),
          import('@/lib/claude-code-preview/runtime-catalog'),
          import('@/lib/claude-code-preview/runtime-updates'),
        ])
      const status = parseLocalRuntimeId(runtimeId)
        ? await localRuntimeStatus(runtimeId)
        : await runtimeStatusWithUpdate(
            teamId,
            userId,
            await requireRuntimeInstance(teamId, runtimeId, userId),
          )

      return status.authenticated
    } catch {
      return
    }
  },
  // Shared by every replica: one requester's asks across all conversations.
  quota: (requesterId) =>
    consumePairQuota(
      { key: `nudge:${requesterId}:hour`, limit: NUDGES_PER_HOUR, windowSeconds: 3600 },
      { key: `nudge:${requesterId}:day`, limit: NUDGES_PER_DAY, windowSeconds: 86_400 },
    ),
  store: async ({ sessionId, userId }, kind, record, since) => {
    // Two clicks on two replicas: only one of them claims the notification.
    const notified = {
      [`${kind}.runtimeId`]: record.runtimeId,
      [`${kind}.requesterId`]: record.requesterId,
      [`${kind}.notifiedAt`]: { $gt: since },
    }
    // Field by field otherwise, so a stored notification time stays.
    const fields = Object.entries(record).map(([field, value]) => [`${kind}.${field}`, value])
    const result = await agentConversations().updateOne(
      { sessionId, userId, ...(since ? { $nor: [notified] } : {}) },
      { $set: since ? { [kind]: record } : Object.fromEntries(fields) },
    )

    return result.modifiedCount > 0
  },
  notify: notifyNudge,
  now: Date.now,
}

// Names and the agent's label only: never an error, a token or the message itself.
const PUSH = {
  signInRequest: (name: string, agent: string) => ({
    title: 'Sign-in requested',
    body: `${name} asked you to sign in ${agent} so their message can run.`,
  }),
}

/**
 * Asks the people who can sign this conversation's agent in. A repeat inside
 * NOTIFY_REPEAT_MS notifies nobody.
 */
export async function nudge(
  kind: NudgeKind,
  input: { teamId: string; runtimeId: string; sessionId: string; requesterId: string },
  requesterRole: NuphosTeamRole,
  deps: NudgeDeps = nudgeDeps,
): Promise<{ askedName: string; notified: boolean }> {
  const { teamId, runtimeId, sessionId, requesterId } = input
  const conversation = await deps.conversation(sessionId)

  if (
    !conversation ||
    conversation.teamId !== teamId ||
    !canReply(conversationAccess(conversation, requesterId))
  )
    throw new AppError(404, 'conversation_not_found', 'Conversation not found')
  if (conversation.runtimeId !== runtimeId)
    throw new AppError(409, 'runtime_mismatch', 'This conversation runs on another agent')
  const members = await deps.members(teamId)
  const recipients = recipientsFor(conversation, requesterId, requesterRole, members)

  if (!recipients[0])
    throw new AppError(409, 'nobody_to_ask', 'Nobody in this team can act on this agent')
  // Only an agent that needs a sign-in holds anyone's messages for one.
  if (kind === 'signInRequest' && (await deps.signedIn(teamId, runtimeId, requesterId)) === true)
    throw new AppError(
      409,
      'already_signed_in',
      'This agent is signed in. Send your message again.',
    )
  const now = deps.now()
  const existing = conversation[kind]
  const sameAsk = existing?.runtimeId === runtimeId && existing.requesterId === requesterId
  const lastNotified = sameAsk && existing.notifiedAt ? new Date(existing.notifiedAt) : undefined
  const repeat = lastNotified !== undefined && now - lastNotified.getTime() < NOTIFY_REPEAT_MS
  const quota = repeat ? null : await deps.quota(requesterId)

  if (quota === 'limited')
    throw new AppError(429, 'too_many_requests', 'You asked too often. Try again later.')
  const record: SignInRequest = {
    runtimeId,
    requesterId,
    requesterName: members.find((member) => member.id === requesterId)?.name ?? 'A teammate',
    askedUserIds: recipients.map((member) => member.id),
    askedName: recipients[0].name,
    // Asking again never extends a hold: it lapses when the first open ask would.
    askedAt: new Date(openSignInRequest(conversation, now)?.askedAt ?? now),
  }
  // Without the shared quota the ask is still stored, so the Inbox lists it.
  const notified =
    quota === 'allowed' &&
    (await deps.store(
      conversation,
      kind,
      { ...record, notifiedAt: new Date(now) },
      new Date(now - NOTIFY_REPEAT_MS),
    ))

  if (notified)
    deps.notify(record.askedUserIds, {
      sessionId,
      teamId,
      ...PUSH[kind](record.requesterName, conversation.runtimeLabel?.trim() || 'an agent'),
    })
  else await deps.store(conversation, kind, record)
  logEvent('info', 'agent.nudge.stored', {
    kind,
    team_id: teamId,
    session_id: sessionId,
    asked: record.askedUserIds.length,
    notified,
  })

  return { askedName: record.askedName, notified }
}

function recipientsFor(
  conversation: NudgeConversation,
  requesterId: string,
  requesterRole: NuphosTeamRole,
  members: Member[],
): Member[] {
  const recipients = signInRecipients(
    conversation.runtimeId ?? '',
    { id: requesterId, role: requesterRole },
    members,
  )

  if (!recipients) throw new AppError(409, 'can_sign_in', 'You can sign this agent in yourself')

  return recipients
}
