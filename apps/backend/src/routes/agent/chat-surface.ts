export function chatSurfaceMessage(surface: string): string {
  return `This turn is being read in ${surface}, not in the Nuphos app. Until you write something, the reader has no evidence anyone picked their message up — so open with one short acknowledgement line before your first tool call, as the system prompt describes.`
}

// Turn sources whose reader is a chat client rather than the Nuphos app. Cron
// and MCP are absent on purpose: nobody is watching those in real time, so an
// "on it" line would be talking to an empty room.
export const CHAT_SURFACES: Record<string, string> = {
  'discord.agent': 'a Discord thread',
  'slack.agent': 'a Slack thread',
  'lark.agent': 'a Lark chat',
}
