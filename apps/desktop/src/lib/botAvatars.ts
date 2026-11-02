// Keep this order stable and only append: existing Agents derive their character from their ID.
export const BOT_AVATARS = [
  '01-vermeer-girl.svg',
  '02-leonardo.svg',
  '03-mona-lisa.svg',
  '04-venus.svg',
  '05-rembrandt.svg',
  '06-beethoven.svg',
  '07-ada.svg',
  '08-socrates.svg',
  '09-frida.svg',
  '10-van-gogh.svg',
  '11-mozart.svg',
  '12-newton.svg',
  '13-shakespeare.svg',
  '14-napoleon.svg',
  '15-cleopatra.svg',
  '16-athena.svg',
  '17-the-scream.svg',
  '18-american-gothic.svg',
  '19-the-fifer.svg',
  '20-son-of-man.svg',
  '21-the-milkmaid.svg',
  '22-lady-with-an-ermine.svg',
  '23-girl-with-peaches.svg',
  '24-the-blue-boy.svg',
  '25-infanta.svg',
  '26-the-swing.svg',
  '27-the-astronomer.svg',
  '28-the-sleeping-gypsy.svg',
  '29-amelia-earhart.svg',
] as const

/** Only the first 28 are derived from an ID, so appending a character never changes an Agent's face. */
export const DEFAULT_BOT_AVATAR_COUNT = 28

export type BotAvatarFile = (typeof BOT_AVATARS)[number]

/** The name an Agent stores when someone picks a character: the file without `.svg`. */
export function botAvatarName(file: BotAvatarFile): string {
  return file.slice(0, -4)
}

// Sentence case would lowercase a person's surname ("Van gogh").
const NAME_LABELS: Partial<Record<BotAvatarFile, string>> = {
  '03-mona-lisa.svg': 'Mona Lisa',
  '10-van-gogh.svg': 'Van Gogh',
  '29-amelia-earhart.svg': 'Amelia Earhart',
}

/** "22-lady-with-an-ermine.svg" → "Lady with an ermine"; people keep their capitals. */
export function botAvatarLabel(file: BotAvatarFile): string {
  const words = botAvatarName(file).slice(3).replaceAll('-', ' ')

  return NAME_LABELS[file] ?? words.charAt(0).toUpperCase() + words.slice(1)
}

export function derivedBotAvatar(agentId: string): BotAvatarFile {
  let hash = 2166136261

  for (const char of agentId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0

  return BOT_AVATARS[hash % DEFAULT_BOT_AVATAR_COUNT]
}

/** The picked character when this build ships it, else the one the ID selects. */
export function botAvatarFile(agentId: string, picked?: string | null): BotAvatarFile {
  return BOT_AVATARS.find((file) => botAvatarName(file) === picked) ?? derivedBotAvatar(agentId)
}

export function botAvatarUrl(agentId: string, picked?: string | null): string {
  return `/bot-avatars/${botAvatarFile(agentId, picked)}`
}
