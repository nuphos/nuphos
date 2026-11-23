// Channel tools for the Claude Code runtime, rebuilt from conversation
// coordinates instead of the per-turn closures the classic loop gets from the
// Slack bridge: the MCP handler runs on any replica with only the
// PreviewToolContext in hand.
import { getConversationBySessionId } from '@/lib/agent/db'
import { ingestInboundFiles } from '@/lib/agent/inbound-files'
import { createSlackMessagingTools } from '@/lib/agent/tools-skilled/messaging-tools'
import { createNotificationTools } from '@/lib/agent/tools-skilled/notification-tools'
import { createLarkOutboundContext } from '@/lib/lark/agent-outbound'
import { createSlackOutboundContext } from '@/lib/slack/agent-outbound'
import { resolveInstalledWorkspaceBot } from '@/lib/slack/installations'
import { createSlackReplyToolContext } from '@/routes/slack/reply-tools'

import { runtimeAttachments } from '../runtime-attachments'
import { placeOnConversationRuntime } from '../session-execution-state'

import { toolModuleFromAiSdkTools } from './ai-sdk-adapter'

import type { PreviewToolContext, PreviewToolModule } from '../preview-tool-context'
import type { InboundFile } from '@/lib/agent/inbound-files'

/**
 * Puts files fetched from Slack on this conversation's runtime, the way a
 * message's own attachments get there: through the transfer store, as its owner.
 */
async function placeFiles(ctx: PreviewToolContext, files: InboundFile[]): Promise<string[]> {
  const self = await getConversationBySessionId(ctx.sessionId)

  if (!self) throw new Error('This conversation no longer exists.')
  const scope = { teamId: ctx.teamId, userId: self.userId, sessionId: ctx.sessionId }
  const ingested = await ingestInboundFiles({ ...scope, files, label: 'Slack attachment' })

  if (ingested?.fileNames.length !== files.length) throw new Error('The files could not be stored.')

  return await placeOnConversationRuntime(
    self,
    await runtimeAttachments([{ type: 'transfer-upload', groupId: ingested.groupId }], scope),
    self.userId,
  )
}

/**
 * Reply-context tools (slack_react, slack_channel_history, slack_search) exist only for a Slack-bound
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
      placeFiles: (files) => placeFiles(ctx, files),
    }),
  )
}

async function outboundTools(ctx: PreviewToolContext): Promise<Record<string, unknown>> {
  const [slackOutbound, larkOutbound] = await Promise.all([
    createSlackOutboundContext({
      userId: ctx.userId,
      teamId: ctx.teamId,
    }),
    createLarkOutboundContext({ teamId: ctx.teamId }),
  ])
  const { slackNotificationTools, larkNotificationTools } = createNotificationTools({
    slackOutbound,
    larkOutbound,
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
