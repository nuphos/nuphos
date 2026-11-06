import { resolveConversationAccessList } from '@/lib/agent/devices/conversation-computer'
import { buildConversationOwnerMap, serializeConversationForViewer } from './conversation-view'
import { answeringIds } from './decision-reply'
import { getLocalActiveAgentRun } from './run-registry'

import type { ConversationAccessFields } from '@/lib/agent/devices/conversation-computer'
import type { AgentConversation } from '@/lib/agent/db'
import type { SessionThreadResource } from '@/lib/agent/session-thread-resources'
import type { SessionExecutionState } from '@/lib/claude-code-preview/runtime-execution-snapshot'
import type { SlackAgentThreadSummary } from '@/lib/slack/agent-bot'

import { channelFacesField } from '@/lib/agent/channel-faces'
import { liveAttachment } from '@/lib/agent/db/shared'
import { lastMessage } from '@/lib/agent/last-message'
import { runChannels } from '@/lib/agent/run-admission'
import { getActiveAgentRunForSession } from '@/lib/agent/run-store'
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
 */
export function restingRuntimeState(
  stored: SessionExecutionState | null | undefined,
  liveRun: boolean,
): SessionExecutionState {
  return stored ?? (liveRun ? RUN_IN_PROGRESS : READY_FOR_NEXT_MESSAGE)
}

/**
 * A reply can be running on another client (desktop, Slack, a scheduled
 * wake-up), so list rows carry the live run the way the detail does: the
 * local registry first, then the shared store.
 */
async function activeRunFor(
  conversation: ListedConversation,
): Promise<(ConversationActiveRun & { channelIds: string[] }) | null> {
  try {
    const run =
      getLocalActiveAgentRun(conversation.userId, conversation.sessionId) ??
      (await getActiveAgentRunForSession(conversation.userId, conversation.sessionId))

    if (!run) return null

    return {
      streamId: run.streamId,
      startedAt: run.startedAt ?? null,
      channelIds: await runChannels({ ...conversation, streamId: run.streamId }),
    }
  } catch {
    return null
  }
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
  const activeRunsPromise = runtimeStatesPromise.then((states) =>
    Promise.all(
      conversations.map(async (conversation, index) => {
        const state = states[index]

        return !state || state.state === 'active' ? activeRunFor(conversation) : null
      }),
    ),
  )
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
  const [desktops, faces, answering, lastMessages] = await Promise.all([
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
      conversations.map((conversation) =>
        lastMessage(conversation, viewer.id).catch(() => null),
      ),
    ),
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
    }
  })
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
