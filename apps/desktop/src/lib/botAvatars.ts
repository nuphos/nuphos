// Keep this order stable: existing Agents derive their character from their ID.
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
] as const

export function botAvatarUrl(agentId: string): string {
  let hash = 2166136261

  for (const char of agentId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0

  return `/bot-avatars/${BOT_AVATARS[hash % BOT_AVATARS.length]}`
}
