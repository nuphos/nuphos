// Channel tools for the Claude Code runtime, rebuilt from conversation
// coordinates instead of the per-turn closures the classic loop gets from the
// Slack bridge: the MCP handler runs on any replica with only the
// PreviewToolContext in hand.
import { createSlackMessagingTools } from '@/lib/agent/tools-skilled/messaging-tools'
import { createNotificationTools } from '@/lib/agent/tools-skilled/notification-tools'
import { createLarkOutboundContext } from '@/lib/lark/agent-outbound'
import { createSlackOutboundContext } from '@/lib/slack/agent-outbound'
import { resolveInstalledWorkspaceBot } from '@/lib/slack/installations'
import { createSlackReplyToolContext } from '@/routes/slack/reply-tools'

import { toolModuleFromAiSdkTools } from './ai-sdk-adapter'

import type { PreviewToolContext, PreviewToolModule } from '../preview-tool-context'

/**
 * Reply-context tools (slack_react, slack_search) exist only for a Slack-bound
 * conversation. The reaction lands on the thread root: the triggering message
 * ts is not part of the conversation's coordinates.
 */
async function slackReplyTools(ctx: PreviewToolContext): Promise<Record<string, unknown>> {
  const thread = ctx.slackThread

  if (!thread) return {}
  const bot = await resolveInstalledWorkspaceBot(thread.teamId)

  if (!bot) return {}

  return createSlackMessagingTools(
    createSlackReplyToolContext({
      token: bot.botToken,
      channel: thread.channelId,
      messageTs: thread.threadTs,
      contextChannelId: thread.channelId,
    }),
  )
}

async function outboundTools(ctx: PreviewToolContext): Promise<Record<string, unknown>> {
  const [slackOutbound, larkOutbound] = await Promise.all([
    createSlackOutboundContext({
      userId: ctx.userId,
      conversationId: ctx.sessionId,
      teamId: ctx.teamId,
    }),
    createLarkOutboundContext({ teamId: ctx.teamId }),
  ])
  const { slackNotificationTools, larkNotificationTools } = createNotificationTools({
    conversationId: ctx.sessionId,
    teamId: ctx.teamId,
    slackOutbound,
    larkOutbound,
    incidentContextGathered: new Set(),
  })

  return { ...slackNotificationTools, ...larkNotificationTools }
}

/** The AI SDK tool set this module adapts; exported for assembly tests. */
export async function previewChannelToolSet(
  ctx: PreviewToolContext,
): Promise<Record<string, unknown>> {
  const [reply, outbound] = await Promise.all([slackReplyTools(ctx), outboundTools(ctx)])

  return { ...reply, ...outbound }
}

export async function slackPreviewToolModule(ctx: PreviewToolContext): Promise<PreviewToolModule> {
  return toolModuleFromAiSdkTools(await previewChannelToolSet(ctx))
}
