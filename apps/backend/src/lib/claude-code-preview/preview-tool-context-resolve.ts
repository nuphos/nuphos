// Builds the PreviewToolContext for an MCP call, which only carries the
// conversation id: locale and the desktop's per-turn context come from the
// conversation doc, the Slack binding from the thread store.
import { getConversationBySessionId } from '@/lib/agent/db'
import { getSlackAgentThreadBySessionId } from '@/lib/slack/agent-bot'

import type { PreviewToolContext } from './preview-tool-context'

export async function resolvePreviewToolContext(args: {
  userId: string
  conversationOwnerUserId?: string
  teamId: string
  sessionId: string
}): Promise<PreviewToolContext> {
  const [conversation, thread] = await Promise.all([
    getConversationBySessionId(args.sessionId),
    getSlackAgentThreadBySessionId(args.sessionId).catch(() => null),
  ])
  const context = conversation?.claudeCodePreviewContext

  return {
    userId: args.userId,
    ...(args.conversationOwnerUserId
      ? { conversationOwnerUserId: args.conversationOwnerUserId }
      : {}),
    teamId: args.teamId,
    sessionId: args.sessionId,
    ...(context?.activeTurnKey ? { turnKey: context.activeTurnKey } : {}),
    ...(context?.activeTurnOrigin ? { turnOrigin: context.activeTurnOrigin } : {}),
    ...(context?.localTools === true ? { localTools: true } : {}),
    locale: conversation?.metadata?.locale ?? 'en',
    ...(context?.diagramId ? { diagramId: context.diagramId } : {}),
    ...(thread
      ? {
          slackThread: {
            teamId: thread.slackWorkspaceId,
            channelId: thread.slackChannelId,
            threadTs: thread.slackThreadTs,
          },
        }
      : {}),
  }
}
