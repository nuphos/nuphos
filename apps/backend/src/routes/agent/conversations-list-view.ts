import { buildConversationOwnerMap, serializeConversationForViewer } from './conversation-view'
import { getLocalActiveAgentRun } from './run-registry'

import type { AgentConversation } from '@/lib/agent/db'
import type { SessionThreadResource } from '@/lib/agent/session-thread-resources'
import type { SlackAgentThreadSummary } from '@/lib/slack/agent-bot'

import { liveAttachment } from '@/lib/agent/db/shared'
import { getActiveAgentRunForSession } from '@/lib/agent/run-store'
import { sessionThreadResources } from '@/lib/agent/session-thread-resources'
import { readRuntimeStates } from '@/lib/claude-code-preview/runtime-state-store'
import { READY_FOR_NEXT_MESSAGE } from '@/lib/claude-code-preview/session-execution-state'
import { logError } from '@/lib/observability'
import { getSlackAgentThreadsBySessionIds } from '@/lib/slack/agent-bot'

type ListedConversation = Record<string, unknown> & { userId: string; sessionId: string }

export type ConversationActiveRun = { streamId: string; startedAt: string | null }

/**
 * A reply can be running on another client (desktop, Slack, a scheduled
 * wake-up), so list rows carry the live run the way the detail does: the
 * local registry first, then the shared store.
 */
async function activeRunFor(
  conversation: ListedConversation,
): Promise<ConversationActiveRun | null> {
  try {
    const run =
      getLocalActiveAgentRun(conversation.userId, conversation.sessionId) ??
      (await getActiveAgentRunForSession(conversation.userId, conversation.sessionId))

    return run ? { streamId: run.streamId, startedAt: run.startedAt ?? null } : null
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
  const [ownerById, slackThreads, activeRuns, runtimeStates, threadResources] = await Promise.all([
    buildConversationOwnerMap(
      teamId,
      conversations.map((conversation) => conversation.userId),
    ),
    slackThreadsPromise,
    Promise.all(conversations.map(activeRunFor)),
    // What the runtime last pushed for each session; the list never asks it.
    readRuntimeStates(
      conversations.map(
        (conversation) =>
          liveAttachment(conversation as unknown as Pick<AgentConversation, 'claudeCodePreview'>)
            ?.openabSessionId,
      ),
    ),
    sessionThreadResources(
      conversations as unknown as Pick<AgentConversation, 'sessionId' | 'firstMessage'>[],
    ).catch((err: unknown) => {
      logError('agent.conversations.thread_resources.error', err, { team_id: teamId })

      return new Map<string, SessionThreadResource[]>()
    }),
  ])
  const slackThreadBySessionId = new Map(slackThreads.map((thread) => [thread.sessionId, thread]))

  return conversations.map((conversation, index) => {
    const runtimeState = runtimeStates[index] ?? READY_FOR_NEXT_MESSAGE

    return {
      ...serializeConversationForViewer(
        conversation,
        viewer,
        ownerById,
        slackThreadBySessionId.get(conversation.sessionId),
      ),
      linkedResources: [
        ...(threadResources.get(conversation.sessionId) ?? []),
        ...((conversation.linkedResources as unknown[] | undefined) ?? []),
      ],
      activeRun: runtimeState.state === 'active' ? (activeRuns[index] ?? null) : null,
      runtimeState,
    }
  })
}
