export type DiscordMessageCreate = {
  id: string
  guild_id?: string
  channel_id: string
  content?: string
  author?: { id: string; username?: string; global_name?: string | null; bot?: boolean }
  member?: { nick?: string | null }
  webhook_id?: string
  mentions?: { id: string }[]
  /** The message this one replies to; Discord inlines it on the event. */
  referenced_message?: DiscordReferencedMessage | null
}

type DiscordReferencedMessage = {
  content?: string
  author?: { username?: string; global_name?: string | null }
  embeds?: {
    title?: string
    description?: string
    fields?: { name: string; value: string }[]
  }[]
}

/** A reply points at a message outside the session log, so quote it inline. */
export function quoteDiscordReply(reply: DiscordReferencedMessage, text: string): string {
  const quoted = [
    reply.content,
    ...(reply.embeds ?? []).flatMap((embed) => [
      embed.title,
      embed.description,
      ...(embed.fields ?? []).map((field) => `${field.name}: ${field.value}`),
    ]),
  ]
    .filter(Boolean)
    .join('\n')
    .trim()
    .slice(0, 4000)

  if (!quoted) return text
  const author = reply.author?.global_name ?? reply.author?.username ?? 'someone'

  return `In reply to ${author}:\n${quoted.replace(/^/gm, '> ')}\n\n${text}`
}
