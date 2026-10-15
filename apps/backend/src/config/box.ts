import { optional } from './env'

/**
 * Boxes: cloud machines Nuphos creates on instabox for a user, registered as that
 * user's devices through a one-time join token. One partner key for the whole
 * deployment; the feature is off when it is unset.
 */
export type BoxConfig = {
  instabox: { apiKey: string; apiUrl?: string } | null
  /** Where a Box downloads the CLI and its runtime bundle; unset means the GitHub release. */
  downloadUrl?: string
  /** What a Box is made from: an instabox template name or a snapshot id; unset means the default template. */
  template?: string
  /** Pinned development runtime, staged only before a new Box first starts. */
  devRuntime?: { url: string; sha256: string }
}

export function boxConfig(): BoxConfig {
  const apiKey = optional('INSTABOX_API_KEY')
  const url = optional('BOX_DEV_RUNTIME_URL')
  const sha256 = optional('BOX_DEV_RUNTIME_SHA256')

  if ((url || sha256) && optional('NODE_ENV') !== 'development')
    throw new Error('BOX_DEV_RUNTIME_* is allowed only in development')
  if (
    (url || sha256) &&
    (!url || !sha256 || !/^https?:\/\//u.test(url) || !/^[a-f0-9]{64}$/u.test(sha256))
  )
    throw new Error('BOX_DEV_RUNTIME_URL and a lowercase SHA256 must be configured together')

  const downloadUrl = optional('NUPHOS_BOX_DOWNLOAD_URL') ?? optional('BOX_DEV_DOWNLOAD_URL')
  const template = optional('NUPHOS_BOX_TEMPLATE') ?? optional('BOX_SNAPSHOT_ID')

  return {
    ...(url && sha256 ? { devRuntime: { url, sha256 } } : {}),
    ...(downloadUrl ? { downloadUrl } : {}),
    ...(template ? { template } : {}),
    instabox: apiKey
      ? {
          apiKey,
          ...(optional('INSTABOX_API_URL') ? { apiUrl: optional('INSTABOX_API_URL') } : {}),
        }
      : null,
  }
}
