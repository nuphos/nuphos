import { countUnreadConversations, getConversationBySessionId } from '@/lib/agent/db'
import { findProposedPlanNumberForConversation } from '@/lib/agent/plans'
import { logError } from '@/lib/observability'

import { createPushAdmitter } from './admit'
import { apnsCredentials, sendApns } from './apns'
import { sendAndroidAlert, sendAndroidBadge } from './badge'
import { pushDeviceStore } from './devices'
import { fcmProjectId, sendFcm, sendFcmBadge } from './fcm'
import { sendIos } from './ios'
import { approvalToolName, classifyTurn, outcomeBody, truncate } from './turn-outcome'
import { watcherCanRead } from './watchers'

import type { ApnsCredentials, ApnsRequest, ApnsResponse } from './apns'
import type { PushDevice, PushDeviceStore } from './devices'
import type { FcmRequest, FcmResponse } from './fcm'
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
  trace?: { userId: string; teamId?: string }
}

export type PushConversation = Parameters<typeof watcherCanRead>[0] & {
  title?: string
  firstMessage?: string
  watcherIds?: string[]
}

export type TurnNotifierDeps = {
  fcmProject?: () => string | null
  sendFcm?: (projectId: string, request: FcmRequest) => Promise<FcmResponse>
  sendFcmBadge?: typeof sendFcmBadge
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
  canRead: (conversation: PushConversation, userId: string) => Promise<boolean>
  schedule: (work: () => void, delayMs: number) => void
  now: () => number
}

export { SESSION_COALESCE_MS, USER_PUSHES_PER_MINUTE } from './admit'
export const BADGE_DEBOUNCE_MS = 5_000

type Alert = { title: string; body: string; sessionId?: string; teamId?: string; category?: string }

type Delivery = {
  run: NotifiableRun
  body: (conversation: PushConversation | null) => Promise<string | null> | string | null
}

function conversationTitle(conversation: PushConversation | null): string {
  const title = conversation?.title?.trim()

  if (title) return title

  return truncate(conversation?.firstMessage?.trim() ?? '', 60) || 'Nuphos'
}

export function createTurnNotifier(deps: TurnNotifierDeps) {
  const { admit, trackedKeys } = createPushAdmitter(deps.now)
  const badgePending = new Set<string>()

  const send = (devices: PushDevice[], payload: Record<string, unknown>, collapseId: string) =>
    sendIos(deps, devices, payload, collapseId)

  /** This user's devices that what is configured can reach. */
  async function reachable(userId: string): Promise<PushDevice[]> {
    const projectId = deps.fcmProject?.()

    return (await deps.devices.listForUser(userId)).filter((device) =>
      device.platform === 'ios'
        ? Boolean(deps.credentials())
        : Boolean(deps.sendFcm) && Boolean(projectId) && device.projectId === projectId,
    )
  }

  /** One alert; without a conversation it opens the app, and Android, which needs one, is skipped. */
  async function alertUser(userId: string, devices: PushDevice[], push: Alert): Promise<void> {
    const { sessionId, teamId, category, ...alert } = push
    const projectId = deps.fcmProject?.()
    const badge = await deps.unreadCount(userId)

    if (sessionId && teamId && deps.sendFcm && projectId)
      await sendAndroidAlert(
        devices,
        projectId,
        { userId, teamId, sessionId, ...alert, badge },
        deps.sendFcm,
        (token) => deps.devices.removeToken(token),
      )
    await send(
      devices,
      {
        aps: {
          alert,
          badge,
          sound: 'default',
          ...(sessionId ? { 'thread-id': sessionId } : {}),
          ...(category ? { category } : {}),
        },
        ...(sessionId ? { sessionId } : {}),
        ...(teamId ? { teamId } : {}),
      },
      sessionId ?? `nudge:${userId}`,
    )
  }

  async function deliver({ run, body }: Delivery): Promise<void> {
    if (!deps.credentials() && !deps.fcmProject?.()) return
    const conversation = await deps.conversation(run.sessionId)
    const teamId = run.trace?.teamId ?? conversation?.teamId
    let text: Promise<string | null> | undefined

    await Promise.all(
      (conversation?.watcherIds ?? []).map(async (userId) => {
        if (!(await deps.canRead(conversation!, userId))) return
        const devices = await reachable(userId)

        if (devices.length === 0) return
        text ??= Promise.resolve(body(conversation))
        const content = await text

        if (content === null || !admit(userId, run.sessionId)) return
        await run.activityRecorded
        await alertUser(userId, devices, {
          title: conversationTitle(conversation),
          body: content,
          sessionId: run.sessionId,
          teamId,
          category: 'REPLY',
        })
      }),
    )
  }

  async function refreshBadge(userId: string): Promise<void> {
    badgePending.delete(userId)
    const devices = await deps.devices.listForUser(userId)

    if (devices.length === 0) return
    const badge = await deps.unreadCount(userId)
    const project = deps.fcmProject?.()

    if (project && deps.sendFcmBadge)
      await sendAndroidBadge(devices, project, userId, badge, deps.sendFcmBadge, (token) =>
        deps.devices.removeToken(token),
      )
    await send(devices, { aps: { badge } }, 'badge')
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
    trackedKeys,
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
        body: async (conversation) => {
          const plan = outcome.kind === 'failed' ? null : await planNumber(run, conversation)

          // Silence never hides approvals, errors, or plans discovered outside MCP.
          if (outcome.kind === 'finished' && !outcome.text.trim() && plan === null) return null

          return outcomeBody(outcome, plan)
        },
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
    /** Asks someone to act on a conversation; it opens there only for someone who can read it. */
    async nudge(userId: string, push: Alert & { sessionId: string }): Promise<void> {
      if (!deps.credentials() && !deps.fcmProject?.()) return
      const devices = await reachable(userId)

      if (devices.length === 0 || !admit(userId, `nudge:${push.sessionId}`)) return
      const conversation = await deps.conversation(push.sessionId)
      const readable = conversation !== null && (await deps.canRead(conversation, userId))

      await alertUser(userId, devices, readable ? push : { ...push, sessionId: undefined })
    },
    /** Reading on one device clears the badge on the others. Debounced per user. */
    badgeChanged(userId: string): void {
      if ((!deps.credentials() && !deps.fcmProject?.()) || badgePending.has(userId)) return
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
    fcmProject: fcmProjectId,
    sendFcm,
    sendFcmBadge,
    devices: pushDeviceStore,
    send: sendApns,
    conversation: getConversationBySessionId,
    proposedPlanNumber: findProposedPlanNumberForConversation,
    unreadCount: (userId) => countUnreadConversations(userId),
    canRead: (conversation, userId) => watcherCanRead(conversation, userId),
    schedule: (work, delayMs) => {
      setTimeout(work, delayMs).unref()
    },
    now: Date.now,
  })

  return notifier
}

function background(event: string, work: () => Promise<void>): void {
  if (!apnsCredentials() && !fcmProjectId()) return
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

/** Each user's devices, rate limited like any push; see sign-in-request.ts. */
export function notifyNudge(
  userIds: string[],
  push: { sessionId: string; teamId: string; title: string; body: string },
): void {
  for (const userId of userIds)
    background('push.nudge_failed', () => defaultNotifier().nudge(userId, push))
}

export function notifyBadgeChanged(userId: string): void {
  if (apnsCredentials() || fcmProjectId()) defaultNotifier().badgeChanged(userId)
}
