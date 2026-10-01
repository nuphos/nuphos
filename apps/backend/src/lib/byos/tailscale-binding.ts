import { decryptTailscaleClientSecret } from '@/lib/byos/secrets'
import { tailscaleFederationAudience } from '@/lib/byos/tailscale'
import { AppError } from '@/lib/errors'

import type { TailscaleAuthHandle } from '@/lib/byos/tailscale'
import type { TailscaleOAuthClientBinding } from '@/models'
import type { ObjectId } from 'mongodb'

export type TailscaleBindingAuth = Pick<
  TailscaleOAuthClientBinding,
  'clientId' | 'encryptedClientSecret' | 'federation'
>

/**
 * Resolve how this binding authenticates to Tailscale. Federation is preferred
 * wherever the customer has set it up, because it leaves Nuphos holding nothing
 * that can be stolen; the stored-secret path stays for bindings created before
 * federation existed.
 */
export function tailscaleAuthHandle(
  binding: TailscaleBindingAuth,
  teamId: ObjectId,
): TailscaleAuthHandle {
  if (binding.federation) {
    return {
      clientId: binding.clientId,
      audience: binding.federation.audience || tailscaleFederationAudience(binding.clientId),
      teamId: teamId.toHexString(),
    }
  }
  if (!binding.encryptedClientSecret) {
    throw new AppError(
      500,
      'tailscale_binding_incomplete',
      'This Tailscale binding has neither a client secret nor a federation trust configured.',
    )
  }

  return {
    clientId: binding.clientId,
    clientSecret: decryptTailscaleClientSecret(binding.encryptedClientSecret),
  }
}

export function isFederatedTailscaleBinding(binding: TailscaleBindingAuth): boolean {
  return Boolean(binding.federation)
}
