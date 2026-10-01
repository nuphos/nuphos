import { buildConversationOwnerMap, serializeConversationForViewer } from './conversation-view'
import { getLocalActiveAgentRun } from './run-registry'

import type { AgentConversation } from '@/lib/agent/db'
import type { SlackAgentThreadSummary } from '@/lib/slack/agent-bot'

import { getActiveAgentRunForSession } from '@/lib/agent/run-store'
import { conversationExecutionState } from '@/lib/claude-code-preview/session-execution-state'
import { logError } from '@/lib/observability'
import { getSlackAgentThreadsBySessionIds } from '@/lib/slack/agent-bot'

type ListedConversation = Record<string, unknown> & { userId: string; sessionId: string }

export type ConversationActiveRun = { streamId: string; startedAt: string | null }

/**
 * A reply can be running on another client (desktop, Slack, a scheduled
 * wake-up), so list rows carry the live run the way the detail does: the
 * local registry first, then the shared store.
 */
async function activeRunFor(conversation: ListedConversation): Promise<{
  activeRun: ConversationActiveRun | null
  runtimeState: Awaited<ReturnType<typeof conversationExecutionState>>
}> {
  try {
    const run =
      getLocalActiveAgentRun(conversation.userId, conversation.sessionId) ??
      (await getActiveAgentRunForSession(conversation.userId, conversation.sessionId))

    const runtimeState = await conversationExecutionState(
      conversation as unknown as AgentConversation,
    )

    return {
      runtimeState,
      activeRun:
        run && runtimeState.state === 'active'
          ? { streamId: run.streamId, startedAt: run.startedAt ?? null }
          : null,
    }
  } catch {
    return { activeRun: null, runtimeState: { state: 'disconnected' } }
  }
}

/** Owner, Slack thread and live-run enrichment for one page of `GET /agent/conversations`. */
export async function serializeConversationList<T extends ListedConversation>(
  conversations: T[],
  viewer: Parameters<typeof serializeConversationForViewer>[1],
  teamId: string | undefined,
): Promise<Record<string, unknown>[]> {
  const slackThreadsPromise: Promise<SlackAgentThreadSummary[]> = getSlackAgentThreadsBySessionIds(
    conversations.map((conversation) => conversation.sessionId),
  ).catch((err: unknown) => {
    logError('agent.conversations.slack_enrichment.error', err, {
      conversation_count: conversations.length,
      team_id: teamId,
    })

    return []
  })
  const [ownerById, slackThreads, activeRuns] = await Promise.all([
    buildConversationOwnerMap(
      teamId,
      conversations.map((conversation) => conversation.userId),
    ),
    slackThreadsPromise,
    Promise.all(conversations.map(activeRunFor)),
  ])
  const slackThreadBySessionId = new Map(slackThreads.map((thread) => [thread.sessionId, thread]))

  return conversations.map((conversation, index) => ({
    ...serializeConversationForViewer(
      conversation,
      viewer,
      ownerById,
      slackThreadBySessionId.get(conversation.sessionId),
    ),
    activeRun: activeRuns[index]?.activeRun ?? null,
    runtimeState: activeRuns[index]?.runtimeState ?? { state: 'unknown' },
  }))
}
