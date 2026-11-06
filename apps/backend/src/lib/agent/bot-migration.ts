// One-off migration for #1691: an agent conversation its owner pinned becomes a
// Bot by getting the face it already shows. Pure planning lives here so it can
// be tested; scripts/migrate-pinned-agents-to-bots.ts does the reads and writes.

/** The first 28 bot-avatar names, in the order clients derive a face from. Keep
 *  in sync with DEFAULT_BOT_AVATAR_COUNT in apps/desktop/src/lib/botAvatars.ts. */
const DERIVED_AVATARS = [
  '01-vermeer-girl',
  '02-leonardo',
  '03-mona-lisa',
  '04-venus',
  '05-rembrandt',
  '06-beethoven',
  '07-ada',
  '08-socrates',
  '09-frida',
  '10-van-gogh',
  '11-mozart',
  '12-newton',
  '13-shakespeare',
  '14-napoleon',
  '15-cleopatra',
  '16-athena',
  '17-the-scream',
  '18-american-gothic',
  '19-the-fifer',
  '20-son-of-man',
  '21-the-milkmaid',
  '22-lady-with-an-ermine',
  '23-girl-with-peaches',
  '24-the-blue-boy',
  '25-infanta',
  '26-the-swing',
  '27-the-astronomer',
  '28-the-sleeping-gypsy',
] as const

/** The face clients show for a conversation with no `avatar` (FNV-1a of the id). */
export function derivedAvatar(sessionId: string): string {
  let hash = 2166136261

  for (const char of sessionId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0

  return DERIVED_AVATARS[hash % DERIVED_AVATARS.length] ?? DERIVED_AVATARS[0]
}

const AGENT_SESSION_KEY_PREFIX = 'agent-session:'
const AGENT_PATH = /\/agent\/([0-9a-f-]{36})(?:[/?#]|$)/i

/** The conversation a sidebar favorite points at, under any key it was pinned with. */
export function pinnedSessionId(entry: { key?: string; href?: string }): string | null {
  if (entry.key?.startsWith(AGENT_SESSION_KEY_PREFIX)) {
    return entry.key.slice(AGENT_SESSION_KEY_PREFIX.length) || null
  }
  const path = entry.key?.match(AGENT_PATH) ? entry.key : entry.href

  return path?.match(AGENT_PATH)?.[1]?.toLowerCase() ?? null
}

export type PinnedFavorites = {
  userId: string
  teamId: string
  entries: { key?: string; href?: string }[]
}

export type PinnedConversation = {
  sessionId: string
  userId: string
  teamId?: string
  kind?: 'channel'
  avatar?: string
}

export type BotMigrationPlan = {
  /** sessionId → avatar to set. */
  promote: Map<string, string>
  counts: {
    agentPins: number
    alreadyBots: number
    toPromote: number
    pinnedByNonOwner: number
    pinnedChannels: number
    missing: number
  }
}

/**
 * Owner pins of agent conversations without an avatar get their derived face.
 * Pins by anyone else, pins of channels and pins of missing conversations are
 * only counted. A conversation pinned twice is counted once per pin.
 */
export function planBotMigration(
  favorites: PinnedFavorites[],
  conversations: Map<string, PinnedConversation>,
): BotMigrationPlan {
  const promote = new Map<string, string>()
  const counts = {
    agentPins: 0,
    alreadyBots: 0,
    toPromote: 0,
    pinnedByNonOwner: 0,
    pinnedChannels: 0,
    missing: 0,
  }

  for (const doc of favorites) {
    for (const entry of doc.entries) {
      const sessionId = pinnedSessionId(entry)

      if (!sessionId) continue
      counts.agentPins += 1
      const conversation = conversations.get(sessionId)

      if (!conversation) counts.missing += 1
      else if (conversation.kind === 'channel') counts.pinnedChannels += 1
      else if (conversation.userId !== doc.userId || conversation.teamId !== doc.teamId)
        counts.pinnedByNonOwner += 1
      else if (conversation.avatar) counts.alreadyBots += 1
      else if (!promote.has(sessionId)) promote.set(sessionId, derivedAvatar(sessionId))
    }
  }
  counts.toPromote = promote.size

  return { promote, counts }
}
