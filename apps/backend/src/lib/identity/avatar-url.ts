/** Only the existing Google profile-image CDN is allowed for self-service avatars. */
export function trustedAvatarURL(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined
  try {
    const url = new URL(value)

    if (url.protocol !== 'https:' || url.port || url.username || url.password) return undefined
    if (!/^lh[3-6]\.googleusercontent\.com$/.test(url.hostname)) return undefined

    return url.href
  } catch {
    return undefined
  }
}
