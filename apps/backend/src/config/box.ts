import { boundedInt, optional } from './env'

/**
 * Boxes: cloud machines Nuphos creates on instabox for a user, registered as that
 * user's devices through a one-time join token. One partner key for the whole
 * deployment; the feature is off when it is unset.
 */
export type BoxConfig = {
  instabox: { apiKey: string; apiUrl?: string } | null
  /** Where a Box downloads the CLI and its runtime bundle; unset means the GitHub release. */
  downloadUrl?: string
  /** vCPUs a team's running Boxes may use when its document sets no `boxVcpuLimit`; unset is unlimited. */
  defaultVcpuLimit?: number
  /** The billing service clients open to buy or change a plan; unset shows no Upgrade. */
  billingUrl?: string
}

export function boxConfig(): BoxConfig {
  const apiKey = optional('INSTABOX_API_KEY')
  const downloadUrl = optional('NUPHOS_BOX_DOWNLOAD_URL') ?? optional('BOX_DEV_DOWNLOAD_URL')

  return {
    ...(downloadUrl ? { downloadUrl } : {}),
    ...(optional('BOX_DEFAULT_VCPU_LIMIT')
      ? { defaultVcpuLimit: boundedInt('BOX_DEFAULT_VCPU_LIMIT', 0, { min: 0, max: 10_000 }) }
      : {}),
    ...(optional('NUPHOS_BILLING_URL') ? { billingUrl: optional('NUPHOS_BILLING_URL') } : {}),
    instabox: apiKey
      ? {
          apiKey,
          ...(optional('INSTABOX_API_URL') ? { apiUrl: optional('INSTABOX_API_URL') } : {}),
        }
      : null,
  }
}
