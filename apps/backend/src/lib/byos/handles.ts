import { assumeRoleWithOidc as assumeAliyunRole } from '@/lib/byos/aliyun'
import { assumeAzureViaOidc } from '@/lib/byos/azure'
import { assumeHuaweiIdentity } from '@/lib/byos/huawei'
import { decryptLinodeToken } from '@/lib/byos/secrets'
import { assumeRoleWithWebIdentity } from '@/lib/byos/tencent'
import { assumeRoleWithOidc as assumeVolcengineRole } from '@/lib/byos/volcengine'
import { AppError } from '@/lib/errors'

import type { AliyunHandle } from '@/lib/byos/aliyun'
import type { AzureHandle } from '@/lib/byos/azure'
import type { HuaweiHandle } from '@/lib/byos/huawei'
import type { LinodeHandle } from '@/lib/byos/linode'
import type { TencentHandle } from '@/lib/byos/tencent'
import type { VolcengineHandle } from '@/lib/byos/volcengine'
import type {
  AliyunAccountBinding,
  AzureAccountBinding,
  HuaweiAccountBinding,
  LinodeAccountBinding,
  TencentAccountBinding,
  VolcengineAccountBinding,
} from '@/models'

/**
 * Binding → callable credential handle, for every provider whose credential is
 * minted on demand rather than stored. These live outside `routes/` because the
 * agent's kubeconfig sync needs them too, and a lib importing a route module
 * would close an import cycle.
 */

/** Assume the binding's CAM role via OIDC for short-lived STS creds (only when TKE/CVM is called). */
export function tencentHandleFor(
  binding: TencentAccountBinding,
  teamId: string,
): Promise<TencentHandle> {
  // Defensive: legacy pre-OIDC bindings (SecretId/SecretKey model) lack roleArn
  // and are removed by the startup migration, but guard here too so any that
  // slip through fail with an actionable re-bind message instead of assuming
  // with an undefined ARN.
  if (!binding.roleArn || !binding.providerId) {
    throw new AppError(
      409,
      'tencent_rebind_required',
      'This Tencent Cloud binding predates the OIDC migration. Remove it and re-bind with a CAM role.',
    )
  }

  return assumeRoleWithWebIdentity(binding.roleArn, binding.providerId, teamId, {
    // Legacy bindings predate the partition field — treat them as China.
    site: binding.site ?? 'china',
    sessionName: `nuphos-${binding.id.toHexString()}`,
  })
}

/** Assume the binding's RAM role via OIDC for short-lived STS creds (only when ACK/ECS is called). */
export function aliyunHandleFor(
  binding: AliyunAccountBinding,
  teamId: string,
): Promise<AliyunHandle> {
  // Defensive: legacy pre-OIDC bindings (AccessKey model) lack roleArn and are
  // removed by the startup migration, but guard here too so any that slip
  // through fail with an actionable re-bind message instead of assuming with an
  // undefined ARN.
  if (!binding.roleArn || !binding.oidcProviderArn) {
    throw new AppError(
      409,
      'aliyun_rebind_required',
      'This Alibaba Cloud binding predates the OIDC migration. Remove it and re-bind with a RAM role.',
    )
  }

  return assumeAliyunRole(binding.roleArn, binding.oidcProviderArn, teamId, {
    // Legacy bindings predate the partition field — treat them as China.
    site: binding.site ?? 'china',
    sessionName: `nuphos-${binding.id.toHexString()}`,
  })
}

/** Assume the binding's role via OIDC for short-lived creds (only when VKE/ECS is called). */
export function volcengineHandleFor(
  binding: VolcengineAccountBinding,
  teamId: string,
): Promise<VolcengineHandle> {
  return assumeVolcengineRole(binding.roleTrn, teamId, {
    sessionName: `nuphos-${binding.id.toHexString()}`,
  })
}

/** Federate into the binding's account via OIDC for short-lived temporary AK/SK. */
export function huaweiHandleFor(
  binding: HuaweiAccountBinding,
  teamId: string,
): Promise<HuaweiHandle> {
  return assumeHuaweiIdentity(
    { domainId: binding.domainId, idpId: binding.idpId, agencyName: binding.agencyName },
    teamId,
  )
}

/** Exchange the binding's app federation for a short-lived ARM token (only when ARM/AKS is called). */
export function azureHandleFor(binding: AzureAccountBinding, teamId: string): Promise<AzureHandle> {
  return assumeAzureViaOidc(
    {
      tenantId: binding.tenantId,
      clientId: binding.clientId,
      subscriptionId: binding.subscriptionId,
    },
    teamId,
  )
}

/** Linode has no federation — the binding stores an encrypted personal access token. */
export function linodeHandleFor(binding: LinodeAccountBinding): LinodeHandle {
  return { token: decryptLinodeToken(binding.encryptedToken) }
}
