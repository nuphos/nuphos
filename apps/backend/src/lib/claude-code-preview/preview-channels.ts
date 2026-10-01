// Channel guidance for a Claude Code preview session, reusing the classic
// prompt's channel blocks. A Slack-bound conversation is always the mirrored
// (dual-surface) variant here: the runtime's text streams to Nuphos and is
// posted into the thread by the run frame sink, whichever side sent the turn.
import { buildSlackMessage } from '@/routes/agent/chat-channel-messages'

import type { PreviewToolContext } from './preview-tool-context'

export function previewChannelPromptSection(
  ctx: Pick<PreviewToolContext, 'teamId' | 'slackThread'>,
): string | null {
  if (!ctx.slackThread) return null

  return buildSlackMessage({ nuphosOriginated: true }, ctx.teamId)
}
