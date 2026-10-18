const HOSTED_AVATAR_PATH = /^\/avatars\/[0-9a-f]{24}\/[0-9a-f]{64}\.webp$/

let apiOrigin: string | undefined

/** Pins uploaded-photo trust to the backend this app talks to; call when the endpoint changes. */
export function setAvatarApiOrigin(url: string): void {
  apiOrigin = new URL(url).origin
}

function currentApiOrigin(): string | undefined {
  if (apiOrigin === undefined && typeof window !== 'undefined') {
    setAvatarApiOrigin(window.api.apiUrlSync())
  }

  return apiOrigin
}

/**
 * Self-service avatars: the Google profile-image CDN, or a photo uploaded to
 * the backend this app is signed in to.
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

  return url.origin === currentApiOrigin()
}
