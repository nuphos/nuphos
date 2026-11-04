import type { AgentMessageMention } from '../../../api/agent-types'

/** A fragment, so sanitizing keeps it and it never leaves the app. */
export const MENTION_HREF = '#mention:'

export function parseMentions(value: unknown): AgentMessageMention[] | undefined {
  if (!Array.isArray(value)) return undefined
  const mentions = value.flatMap((item: Partial<AgentMessageMention> | null) =>
    typeof item?.id === 'string' &&
    item.id &&
    typeof item.displayName === 'string' &&
    item.displayName
      ? [{ id: item.id, displayName: item.displayName }]
      : [],
  )

  return mentions.length > 0 ? mentions : undefined
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
const escapeLabel = (s: string) => s.replace(/[\\`*_[\]~<>]/g, String.raw`\$&`)

/**
 * Turns each `@Name` the message mentions into a markdown link the transcript
 * renders as that person. Longer names first, so `@Mei Chen` beats `@Mei`.
 */
export function linkMentions(text: string, mentions: AgentMessageMention[] | undefined): string {
  if (!mentions?.length || !text.includes('@')) return text
  const byName = new Map(mentions.map((mention) => [mention.displayName, mention.id]))
  const names = [...byName.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp)
  const pattern = new RegExp(String.raw`(?<![\w.@])@(${names.join('|')})(?![\w@])`, 'g')

  return text.replace(pattern, (_, name: string) => {
    const label = escapeLabel('@' + name)
    const id = encodeURIComponent(byName.get(name) ?? '')

    return `[${label}](${MENTION_HREF}${id})`
  })
}
