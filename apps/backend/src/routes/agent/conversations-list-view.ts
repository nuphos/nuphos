import { resolveConversationAccessList } from '@/lib/agent/devices/conversation-computer'
import { buildConversationOwnerMap, serializeConversationForViewer } from './conversation-view'
import { answeringIds } from './decision-reply'
import { listRow } from './list-row'
import { getLocalActiveAgentRun } from './run-registry'

import type { ConversationAccessFields } from '@/lib/agent/devices/conversation-computer'
import type { AgentConversation } from '@/lib/agent/db'
import type { SessionThreadResource } from '@/lib/agent/session-thread-resources'
import type { SessionExecutionState } from '@/lib/claude-code-preview/runtime-execution-snapshot'
import type { SlackAgentThreadSummary } from '@/lib/slack/agent-bot'

import { botPresence, botRuntimes } from '@/lib/agent/bot-presence'
import { channelFacesField } from '@/lib/agent/channel-faces'
import { attentionInputRequests } from '@/lib/agent/db/pending-decision'
import { agentConversations, liveAttachment } from '@/lib/agent/db/shared'
import { lastMessage } from '@/lib/agent/last-message'
import { runChannels } from '@/lib/agent/run-admission'
import { getActiveAgentRunsForSessions } from '@/lib/agent/run-store'
import { sessionThreadResources } from '@/lib/agent/session-thread-resources'
import { withRunChannels } from '@/lib/claude-code-preview/runtime-execution-snapshot'
import { readRuntimeStates } from '@/lib/claude-code-preview/runtime-state-store'
import { sessionDesktops, withDesktops } from '@/lib/claude-code-preview/session-desktops'
import { READY_FOR_NEXT_MESSAGE } from '@/lib/claude-code-preview/session-execution-state'
import { logError } from '@/lib/observability'
import { getSlackAgentThreadsBySessionIds } from '@/lib/slack/agent-bot'

type ListedConversation = Record<string, unknown> & { userId: string; sessionId: string }

export type ConversationActiveRun = { streamId: string; startedAt: string | null }

const RUN_IN_PROGRESS: SessionExecutionState = {
  state: 'active',
  schemaVersion: 2,
  phase: 'working',
  label: 'Working…',
  actions: { send: false, cancel: true, steer: false, reply: false },
}

/**
 * A session's state when its runtime is not asked or cannot be reached: what the
 * runtime last pushed, else what a live run implies. The list and the detail
 * both answer with this, so two readers of one session never disagree.
 *
 * A turn runs while its run holds the session, which is also where its channels
 * come from. A push can still say active just after the run ended; read alone,
 * it would be a turn that answers no channel.
 */
export function restingRuntimeState(
  stored: SessionExecutionState | null | undefined,
  liveRun: boolean,
): SessionExecutionState {
  if (stored?.state === 'active' && !liveRun) return READY_FOR_NEXT_MESSAGE

  return stored ?? (liveRun ? RUN_IN_PROGRESS : READY_FOR_NEXT_MESSAGE)
}

/** A live run on this replica as a list row shows it, with the channels it answers. */
async function withChannels(
  conversation: ListedConversation,
  run: ConversationActiveRun & { channelIds: string[] },
): Promise<ConversationActiveRun & { channelIds: string[] }> {
  return {
    streamId: run.streamId,
    startedAt: run.startedAt ?? null,
    // A post steered in on another replica is only in the shared store; without it, the run's own.
    channelIds: await runChannels({ ...conversation, streamId: run.streamId }).catch(
      () => run.channelIds,
    ),
  }
}

/**
 * A reply can be running on another client (desktop, Slack, a scheduled wake-up),
 * so list rows carry the live run the way the detail does: the local registry first,
 * then the shared store, asked once for the whole page.
 */
async function activeRunsFor(conversations: ListedConversation[]) {
  const local = conversations.map((c) => getLocalActiveAgentRun(c.userId, c.sessionId))
  const shared = await getActiveAgentRunsForSessions(
    conversations.filter((_, i) => !local[i]),
  ).catch(() => [])
  let next = 0

  return Promise.all(
    conversations.map(async (conversation, i) => {
      if (local[i]) return withChannels(conversation, local[i])
      const run = shared[next++]

      // The shared store's runs come with their channels, read for the whole page.
      return run
        ? { streamId: run.streamId, startedAt: run.startedAt, channelIds: run.channelIds }
        : null
    }),
  )
}

const TASK_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * How many of each Bot's own Tasks run or wait on someone, as counts anyone who can see
 * the Bot may read (#4270): the Tasks belong to the Bot's owner, so another member's
 * list never carries them, and their titles stay the owner's.
 */
async function botTaskCounts(teamId: string, bots: ListedConversation[]) {
  const counts = new Map(bots.map((bot) => [bot.sessionId, { running: 0, waiting: 0 }]))
  const kids = (await agentConversations()
    .find({
      // Keyed like the { teamId, userId, parentSessionId, lastActiveAt } index: a Bot's Tasks are its owner's.
      teamId,
      userId: { $in: [...new Set(bots.map((bot) => bot.userId))] },
      parentSessionId: { $in: [...counts.keys()] },
      archivedAt: { $exists: false },
      lastActiveAt: { $gt: new Date(Date.now() - TASK_WINDOW_MS) },
    })
    .limit(200)
    .toArray()) as unknown as (ListedConversation & AgentConversation)[]
  const states = await readRuntimeStates(
    teamId,
    kids.map((kid) => liveAttachment(kid)?.openabSessionId),
  )
  const runs = await activeRunsFor(kids)

  kids.forEach((kid, i) => {
    const count = counts.get(String(kid.parentSessionId))

    if (!count) return
    if (attentionInputRequests(kid).length > 0) count.waiting += 1
    else if (restingRuntimeState(states[i], Boolean(runs[i])).state === 'active') count.running += 1
  })

  return counts
}

/** Owner, Slack thread and live-run enrichment for one page of `GET /agent/conversations`. */
export async function serializeConversationList<T extends ListedConversation>(
  conversations: T[],
  viewer: Parameters<typeof serializeConversationForViewer>[1],
  teamId: string | undefined,
): Promise<Record<string, unknown>[]> {
  const sessionIds = conversations.map((conversation) => conversation.sessionId)
  const slackThreadsPromise: Promise<SlackAgentThreadSummary[]> = getSlackAgentThreadsBySessionIds(
    sessionIds,
  ).catch((err: unknown) => {
    logError('agent.conversations.slack_enrichment.error', err, {
      conversation_count: conversations.length,
      team_id: teamId,
    })

    return []
  })
  // What the runtime last pushed for each session; the list never asks it.
  const runtimeStatesPromise = teamId
    ? readRuntimeStates(
        teamId,
        conversations.map(
          (conversation) =>
            liveAttachment(conversation as unknown as Pick<AgentConversation, 'claudeCodePreview'>)
              ?.openabSessionId,
        ),
      )
    : Promise.resolve(conversations.map(() => null))
  // A stored idle or dormant snapshot already says no run is live.
  const activeRunsPromise = runtimeStatesPromise.then(async (states) => {
    const asked = conversations.filter((_, i) => {
      const state = states[i]

      return !state || state.state === 'active'
    })
    const runs = await activeRunsFor(asked)

    return conversations.map((conversation) => runs[asked.indexOf(conversation)] ?? null)
  })
  const [ownerById, slackThreads, activeRuns, runtimeStates, threadResources, accesses] =
    await Promise.all([
      buildConversationOwnerMap(
        teamId,
        conversations.map((conversation) => conversation.userId),
      ),
      slackThreadsPromise,
      activeRunsPromise,
      runtimeStatesPromise,
      sessionThreadResources(
        conversations as unknown as Pick<AgentConversation, 'sessionId' | 'firstMessage'>[],
      ).catch((err: unknown) => {
        logError('agent.conversations.thread_resources.error', err, { team_id: teamId })

        return new Map<string, SessionThreadResource[]>()
      }),
      resolveConversationAccessList(
        conversations as unknown as ConversationAccessFields[],
        viewer.id,
      ),
    ])
  const slackThreadBySessionId = new Map(slackThreads.map((thread) => [thread.sessionId, thread]))

  // A conversation's desktops on its Box come from the device's presence, not the snapshot.
  const bots = conversations.filter(
    (conversation) => conversation.avatar && conversation.kind !== 'channel',
  )
  const [desktops, faces, answering, lastMessages, runtimes, taskCounts] = await Promise.all([
    Promise.all(conversations.map((conversation) => sessionDesktops(conversation))),
    Promise.all(
      conversations.map((conversation) =>
        channelFacesField(conversation as unknown as AgentConversation, viewer.id, ownerById),
      ),
    ),
    // A question a queued message answers no longer waits on anyone.
    Promise.all(
      conversations.map((conversation) =>
        answeringIds(conversation as unknown as AgentConversation),
      ),
    ),
    Promise.all(
      conversations.map((conversation) => lastMessage(conversation, viewer.id).catch(() => null)),
    ),
    teamId && bots.length
      ? botRuntimes(teamId, bots as { userId: string; runtimeId?: string }[]).catch(
          (err: unknown) => {
            logError('agent.conversations.bot_presence.error', err, { team_id: teamId })

            return undefined
          },
        )
      : undefined,
    teamId && bots.length
      ? botTaskCounts(teamId, bots).catch((err: unknown) => {
          logError('agent.conversations.bot_tasks.error', err, { team_id: teamId })

          return undefined
        })
      : undefined,
  ])

  return conversations.map((conversation, index) => {
    const run = activeRuns[index]
    const runtimeState = withRunChannels(
      withDesktops(
        restingRuntimeState(runtimeStates[index], Boolean(run)),
        desktops[index] ?? { tools: [], canOpen: false },
      ),
      run,
    )
    const bot = runtimes ? bots.indexOf(conversation) : -1

    return {
      ...listRow(
        serializeConversationForViewer(
          conversation,
          viewer,
          ownerById,
          slackThreadBySessionId.get(conversation.sessionId),
          accesses[index] ?? null,
          answering[index],
        ),
      ),
      linkedResources: [
        ...(threadResources.get(conversation.sessionId) ?? []),
        ...((conversation.linkedResources as unknown[] | undefined) ?? []),
      ],
      activeRun:
        runtimeState.state === 'active' && run
          ? { streamId: run.streamId, startedAt: run.startedAt }
          : null,
      runtimeState,
      ...faces[index],
      ...(lastMessages[index] ? { lastMessage: lastMessages[index] } : {}),
      ...(runtimes && bot >= 0
        ? {
            presence: botPresence({
              ownerRemoved: Boolean(ownerById.get(conversation.userId)?.deactivated),
              runtime: runtimes[bot] ?? null,
              busy: runtimeState.state === 'active' && Boolean(run),
            }),
          }
        : {}),
      ...(taskCounts?.has(conversation.sessionId)
        ? { tasks: taskCounts.get(conversation.sessionId) }
        : {}),
    }
  })
}
