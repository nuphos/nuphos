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
  /**
   * What a Box is made from: an instabox template name or a snapshot id, which must already
   * carry node 22, claude, codex and nuphos. Unset means the default template, installed on create.
   */
  template?: string
}

export function boxConfig(): BoxConfig {
  const apiKey = optional('INSTABOX_API_KEY')
  const downloadUrl = optional('NUPHOS_BOX_DOWNLOAD_URL') ?? optional('BOX_DEV_DOWNLOAD_URL')
  const template = optional('NUPHOS_BOX_TEMPLATE') ?? optional('BOX_SNAPSHOT_ID')

  return {
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
