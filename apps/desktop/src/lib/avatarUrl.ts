const HOSTED_AVATAR_PATH = /^\/avatars\/[0-9a-f]{24}\/[0-9a-f]{64}\.webp$/

/**
 * Self-service avatars: the Google profile-image CDN, or a photo uploaded to a
 * Nuphos backend. The backend accepts only its own origin for the latter.
 */
export function trustedAvatarURL(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined
  try {
    const url = new URL(value)

    if (url.username || url.password) return undefined
    if (isUploadedAvatar(url)) return url.href
    if (url.protocol !== 'https:' || url.port) return undefined
    if (!/^lh[3-6]\.googleusercontent\.com$/.test(url.hostname)) return undefined

    return url.href
  } catch {
    return undefined
  }
}

function isUploadedAvatar(url: URL): boolean {
  if (url.search || url.hash || !HOSTED_AVATAR_PATH.test(url.pathname)) return false
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'

  return url.protocol === 'https:' || (url.protocol === 'http:' && local)
}
