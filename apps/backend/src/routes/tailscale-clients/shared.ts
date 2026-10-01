import type { TailscaleOAuthClientBinding } from '@/models'

export function publicView(binding: TailscaleOAuthClientBinding) {
  return {
    id: binding.id.toHexString(),
    label: binding.label,
    clientId: binding.clientId,
    createdAt: binding.createdAt,
    authMode: binding.federation ? 'federated' : 'oauth_client',
    audience: binding.federation?.audience ?? null,
    sandboxAccess: binding.sandboxAccess
      ? {
          enabled: binding.sandboxAccess.enabled,
          tag: binding.sandboxAccess.tag,
          enabledAt: binding.sandboxAccess.enabledAt,
        }
      : null,
  }
}
