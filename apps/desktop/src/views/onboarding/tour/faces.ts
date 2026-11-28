import { BOT_AVATARS, botAvatarName } from '../../../lib/botAvatars'

/** Every face, by name ("09-frida"), in the order the picker shows them. */
export const FACES = BOT_AVATARS.map(botAvatarName)

export const faceSrc = (face: string) => `/bot-avatars/${face}.svg`

/** A face for anyone who did not pick one; only for looks, so any spread will do. */
export function randomFace(): string {
  const [value = 0] = crypto.getRandomValues(new Uint32Array(1))

  return FACES[value % FACES.length] ?? FACES[0] ?? ''
}
