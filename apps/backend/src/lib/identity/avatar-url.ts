import { config } from '@/config'

const HOSTED_AVATAR_PATH = /^\/avatars\/[0-9a-f]{24}\/[0-9a-f]{64}\.webp$/

export function hostedAvatarPath(userId: string, hash: string): string {
  return `/avatars/${userId}/${hash}.webp`
}

/** Self-service avatars: the Google profile-image CDN or an image uploaded to this backend. */
export function trustedAvatarURL(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined
  try {
    const url = new URL(value)

    if (url.username || url.password) return undefined
    if (isHostedAvatar(url)) return url.href
    if (url.protocol !== 'https:' || url.port) return undefined
    if (!/^lh[3-6]\.googleusercontent\.com$/.test(url.hostname)) return undefined

    return url.href
  } catch {
    return undefined
  }
}

/** The user id in an avatar URL this backend serves, or undefined for any other URL. */
export function hostedAvatarOwner(value: string): string | undefined {
  const url = new URL(value)

  return isHostedAvatar(url) ? url.pathname.split('/')[2] : undefined
}

function isHostedAvatar(url: URL): boolean {
  const base = new URL(config.auth.publicBaseUrl).href.replace(/\/$/, '')

  if (url.search || url.hash || !url.href.startsWith(`${base}/avatars/`)) return false

  return HOSTED_AVATAR_PATH.test(url.href.slice(base.length))
}
