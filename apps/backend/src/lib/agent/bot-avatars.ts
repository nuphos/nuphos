// The bot-avatar catalog, by name (the file in each client without `.svg`).
// Keep in step with apps/desktop/src/lib/botAvatars.ts: same order, append only.
export const BOT_AVATARS = [
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
  '29-amelia-earhart',
] as const

export type BotAvatar = (typeof BOT_AVATARS)[number]

/** Only the first 28 are derived from an id, so appending a face changes no one's. */
const DERIVED_COUNT = 28

/** The face clients show for a conversation with no `avatar` (FNV-1a of the id). */
export function derivedAvatar(sessionId: string): BotAvatar {
  let hash = 2166136261

  for (const char of sessionId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0

  return BOT_AVATARS[hash % DERIVED_COUNT] ?? BOT_AVATARS[0]
}
