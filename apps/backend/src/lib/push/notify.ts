import { countUnreadConversations, getConversationBySessionId } from '@/lib/agent/db'
import { findProposedPlanNumberForConversation } from '@/lib/agent/plans'
import { logError, logEvent } from '@/lib/observability'

import { apnsCredentials, isDeadToken, sendApns } from './apns'
import { pushDeviceStore } from './devices'
import { approvalToolName, classifyTurn, outcomeBody, truncate } from './turn-outcome'

import type { ApnsCredentials, ApnsRequest, ApnsResponse } from './apns'
import type { PushDevice, PushDeviceStore } from './devices'
import type { TurnOutcome } from './turn-outcome'

export type NotifiableRun = {
  userId: string
  sessionId: string
  createdAt: number
  frames: readonly string[]
  abortController: { signal: { aborted: boolean } }
  awaitingAuthorization?: boolean
  awaitingDecision?: string
  approvalPushed?: boolean
  activityRecorded?: Promise<unknown>
  trace?: { userId: string; teamId?: string; method: string }
}

export type PushConversation = { title?: string; firstMessage?: string; teamId?: string }

export type TurnNotifierDeps = {
  credentials: () => ApnsCredentials | null
  devices: PushDeviceStore
  send: (credentials: ApnsCredentials, request: ApnsRequest) => Promise<ApnsResponse>
  conversation: (sessionId: string) => Promise<PushConversation | null>
  proposedPlanNumber: (
    sessionId: string,
    scope: { teamId?: string; userId: string },
    since: Date,
  ) => Promise<number | null>
  unreadCount: (userId: string) => Promise<number>
  schedule: (work: () => void, delayMs: number) => void
  now: () => number
}

// One push per conversation per window: a burst of turns (auto-continuations,
// quick follow-ups) collapses into the first, and the user is plainly around.
export const SESSION_COALESCE_MS = 20_000
export const USER_PUSHES_PER_MINUTE = 8
export const BADGE_DEBOUNCE_MS = 5_000

const USER_WINDOW_MS = 60_000

type Delivery = {
  run: NotifiableRun
  body: (conversation: PushConversation | null) => Promise<string> | string
}

function conversationTitle(conversation: PushConversation | null): string {
  const title = conversation?.title?.trim()

  if (title) return title

  return truncate(conversation?.firstMessage?.trim() ?? '', 60) || 'Nuphos'
}

export function createTurnNotifier(deps: TurnNotifierDeps) {
  const lastBySession = new Map<string, number>()
  const recentByUser = new Map<string, number[]>()
  const badgePending = new Set<string>()
  let lastSweep = deps.now()

  function sweep(now: number): void {
    if (now - lastSweep < USER_WINDOW_MS) return
    lastSweep = now
    for (const [key, at] of lastBySession) {
      if (now - at >= SESSION_COALESCE_MS) lastBySession.delete(key)
    }
    for (const [userId, times] of recentByUser) {
      if (times.every((at) => now - at >= USER_WINDOW_MS)) recentByUser.delete(userId)
    }
  }

  function admit(userId: string, sessionId: string): boolean {
    const now = deps.now()
    const sessionKey = `${userId}:${sessionId}`
    const last = lastBySession.get(sessionKey)

    sweep(now)
    if (last !== undefined && now - last < SESSION_COALESCE_MS) return false
    const recent = (recentByUser.get(userId) ?? []).filter((at) => now - at < USER_WINDOW_MS)

    if (recent.length >= USER_PUSHES_PER_MINUTE) return false
    recent.push(now)
    recentByUser.set(userId, recent)
    lastBySession.set(sessionKey, now)

    return true
  }

  async function send(devices: PushDevice[], payload: Record<string, unknown>, collapseId: string) {
    const credentials = deps.credentials()

    if (!credentials) return
    await Promise.all(
      devices.map(async (device) => {
        try {
          const response = await deps.send(credentials, {
            deviceToken: device.token,
            environment: device.environment,
            payload,
            collapseId,
          })

          if (isDeadToken(response)) {
            await deps.devices.removeToken(device.token)
          } else if (response.status !== 200) {
            logEvent('warn', 'push.apns.rejected', {
              status: response.status,
              reason: response.reason ?? null,
            })
          }
        } catch (error) {
          logError('push.apns.send_failed', error, { collapse_id: collapseId })
        }
      }),
    )
  }

  async function deliver({ run, body }: Delivery): Promise<void> {
    if (!deps.credentials() || run.trace?.method === 'TRIGGER') return
    const userId = run.trace?.userId ?? run.userId
    const devices = await deps.devices.listForUser(userId)

    if (devices.length === 0 || !admit(userId, run.sessionId)) return
    const conversation = await deps.conversation(run.sessionId)
    const teamId = run.trace?.teamId ?? conversation?.teamId
    const alert = { title: conversationTitle(conversation), body: await body(conversation) }

    await run.activityRecorded
    const badge = await deps.unreadCount(userId)

    await send(
      devices,
      {
        aps: { alert, badge, sound: 'default', 'thread-id': run.sessionId },
        sessionId: run.sessionId,
        ...(teamId ? { teamId } : {}),
      },
      run.sessionId,
    )
  }

  async function refreshBadge(userId: string): Promise<void> {
    badgePending.delete(userId)
    const devices = await deps.devices.listForUser(userId)

    if (devices.length === 0) return
    await send(devices, { aps: { badge: await deps.unreadCount(userId) } }, 'badge')
  }

  async function planNumber(run: NotifiableRun, conversation: PushConversation | null) {
    return deps.proposedPlanNumber(
      run.sessionId,
      {
        teamId: run.trace?.teamId ?? conversation?.teamId,
        userId: run.trace?.userId ?? run.userId,
      },
      new Date(run.createdAt),
    )
  }

  return {
    trackedKeys: () => lastBySession.size + recentByUser.size,
    async runEnded(run: NotifiableRun): Promise<void> {
      const outcome: TurnOutcome | null = classifyTurn({
        frames: run.frames,
        aborted: run.abortController.signal.aborted,
        awaitingAuthorization: run.awaitingAuthorization,
        awaitingDecision: run.awaitingDecision,
      })

      if (!outcome || (outcome.kind === 'approval' && run.approvalPushed)) return
      await deliver({
        run,
        body: async (conversation) =>
          outcomeBody(
            outcome,
            outcome.kind === 'failed' ? null : await planNumber(run, conversation),
          ),
      })
    },
    async approvalRequested(run: NotifiableRun): Promise<void> {
      if (run.approvalPushed) return
      run.approvalPushed = true
      const toolName = approvalToolName(run.frames)

      await deliver({
        run,
        body: () => outcomeBody({ kind: 'approval', ...(toolName ? { toolName } : {}) }, null),
      })
    },
    /** Reading on one device clears the badge on the others. Debounced per user. */
    badgeChanged(userId: string): void {
      if (!deps.credentials() || badgePending.has(userId)) return
      badgePending.add(userId)
      deps.schedule(() => {
        void refreshBadge(userId).catch((error: unknown) => {
          logError('push.badge_failed', error)
        })
      }, BADGE_DEBOUNCE_MS)
    },
  }
}

let notifier: ReturnType<typeof createTurnNotifier> | null = null

function defaultNotifier() {
  notifier ??= createTurnNotifier({
    credentials: apnsCredentials,
    devices: pushDeviceStore,
    send: sendApns,
    conversation: getConversationBySessionId,
    proposedPlanNumber: findProposedPlanNumberForConversation,
    unreadCount: (userId) => countUnreadConversations(userId),
    schedule: (work, delayMs) => {
      setTimeout(work, delayMs).unref()
    },
    now: Date.now,
  })

  return notifier
}

function background(event: string, work: () => Promise<void>): void {
  if (!apnsCredentials()) return
  void work().catch((error: unknown) => {
    logError(event, error)
  })
}

export function notifyAgentRunEnded(run: NotifiableRun): void {
  background('push.run_ended_failed', () => defaultNotifier().runEnded(run))
}

export function notifyApprovalRequested(run: NotifiableRun): void {
  background('push.approval_failed', () => defaultNotifier().approvalRequested(run))
}

export function notifyBadgeChanged(userId: string): void {
  if (apnsCredentials()) defaultNotifier().badgeChanged(userId)
}
