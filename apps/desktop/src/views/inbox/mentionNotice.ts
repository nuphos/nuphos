import type { ChannelMention } from '../../api/agent-types'

/** Mentions not seen before; with nothing seen yet, the list is what was already there. */
export function freshMentions(
  seen: ReadonlySet<string> | null,
  mentions: readonly ChannelMention[],
): ChannelMention[] {
  return seen ? mentions.filter((mention) => !seen.has(mention.messageId)) : []
}
