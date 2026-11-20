import { resolveConversationAccessList } from '@/lib/agent/devices/conversation-computer'
import { buildConversationOwnerMap, serializeConversationForViewer } from './conversation-view'
import { withDecisionConversations } from './decision-conversations'
import { answeringIds } from './decision-reply'
import { getLocalActiveAgentRun } from './run-registry'

import type { ConversationAccessFields } from '@/lib/agent/devices/conversation-computer'
import type { AgentConversation } from '@/lib/agent/db'
import type { SessionThreadResource } from '@/lib/agent/session-thread-resources'
import type { SessionExecutionState } from '@/lib/claude-code-preview/runtime-execution-snapshot'
import type { SlackAgentThreadSummary } from '@/lib/slack/agent-bot'

import { botPresence, botRuntimes } from '@/lib/agent/bot-presence'
import { channelFacesField } from '@/lib/agent/channel-faces'
import { liveAttachment } from '@/lib/agent/db/shared'
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
  const [desktops, faces, answering, lastMessages, runtimes] = await Promise.all([
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
  ])

  return Promise.all(
    conversations.map(async (conversation, index) => {
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
          await withDecisionConversations(
            serializeConversationForViewer(
              conversation,
              viewer,
              ownerById,
              slackThreadBySessionId.get(conversation.sessionId),
              accesses[index] ?? null,
              answering[index],
            ),
            conversation as unknown as AgentConversation,
            viewer.id,
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
      }
    }),
  )
}

/**
 * A list row without what only the open conversation or the server reads.
 * Clients poll the whole list every few seconds, and the runtime attachment
 * and the per-model token breakdown were a third of each row. Lists show only
 * the cost. The credential selection stays: the desktop chat summary counts
 * it from the polled row.
 */
function listRow(row: Record<string, unknown>): Record<string, unknown> {
  const {
    claudeCodePreview: _claudeCodePreview,
    claudeCodePreviewContext: _claudeCodePreviewContext,
    claudeCodePreviewWorkLost: _claudeCodePreviewWorkLost,
    initialSessionConfig: _initialSessionConfig,
    compactionSummary: _compactionSummary,
    compactionMessageCount: _compactionMessageCount,
    conversationTraceParent: _conversationTraceParent,
    runtimeMigration: _runtimeMigration,
    modelFallback: _modelFallback,
    tokenUsage,
    ...rest
  } = row
  const costUsd = (tokenUsage as { costUsd?: unknown } | undefined)?.costUsd

  return typeof costUsd === 'number' ? { ...rest, tokenUsage: { costUsd } } : rest
}
