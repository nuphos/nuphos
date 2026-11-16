import { PROVIDERS } from '../../components/binding-access-providers'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { connectAllowList } from '../../lib/bindingShare'

import type { SubmitEnv } from './submit-env'
import type { BindingAccessProvider } from '../../components/binding-access-providers'

/** The providers this dialog shares right after connecting them. */
export const SHAREABLE_PROVIDERS = new Set<string>([
  'linode',
  'hetzner',
  'betterstack',
  'uptime-kuma',
  'tailscale',
  'tencent',
  'aliyun',
  'volcengine',
  'huawei',
  'vanta',
  'secureframe',
  'notion',
  'upstash',
  'resend',
])

/** Connections the backend keeps private even when the team shares new ones by default. */
export const HIGH_PRIVILEGE_PROVIDERS = new Set<string>([
  'aws',
  'gcp',
  'azure',
  'tencent',
  'aliyun',
  'volcengine',
  'huawei',
  'linode',
  'hetzner',
  'tailscale',
  'upstash',
  'cloudflare',
])

/**
 * Applies the members chosen while connecting, once the binding exists. The
 * backend already applied the default, so an untouched choice makes no call.
 */
export async function shareNewBinding(
  env: SubmitEnv,
  provider: BindingAccessProvider,
  bindingId: string,
): Promise<void> {
  if (!env.shareList) return
  const config = PROVIDERS[provider]

  try {
    const { ownerUserId } = await config.load(env.teamId, bindingId)

    await config.save(env.teamId, bindingId, {
      memberAllowList: connectAllowList(env.shareList, ownerUserId),
    })
  } catch (err) {
    toast.apiError(
      t('Connected, but could not share it. Change who can use it from its page.'),
      err,
    )
  }
}
