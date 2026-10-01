import type { AgentSlackThread } from '../../../api'

export function slackThreadFallbackUrl(thread: AgentSlackThread): string {
  return `https://app.slack.com/client/${encodeURIComponent(thread.workspaceId)}/${encodeURIComponent(thread.channelId)}/thread/${encodeURIComponent(thread.channelId)}-${encodeURIComponent(thread.threadTs)}`
}
