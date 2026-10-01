import { call } from './client'

export type TencentSite = 'china' | 'international'

export type TencentAccount = {
  id: string
  label: string
  site: TencentSite
  roleArn: string
  createdAt?: string
}

export type AliyunSite = 'china' | 'international'

export type AliyunAccount = {
  id: string
  label: string
  site: AliyunSite
  roleArn: string
  createdAt?: string
}

export type VolcengineAccount = {
  id: string
  label: string
  roleTrn: string
  createdAt?: string
}

type TencentAccountResponse = {
  accountId: string
  label: string
  site?: TencentSite
  roleArn: string
  createdAt?: string
}

export async function listTencentAccounts(teamId: string): Promise<TencentAccount[]> {
  const data = await call<{ accounts: TencentAccountResponse[] }>(
    'GET',
    `/teams/${teamId}/tencent-accounts`,
  )

  return (data.accounts ?? []).map((a) => ({
    id: a.accountId,
    label: a.label,
    site: a.site ?? 'china',
    roleArn: a.roleArn,
    createdAt: a.createdAt,
  }))
}

// OIDC federation details the customer needs to register Nuphos as a CAM OIDC
// identity provider and pin their role's trust policy: issuer URL, audience
// (client id), and this team's subject claim.
export type TencentOidcInfo = {
  configured: boolean
  issuer: string
  audience: string
  subject: string
  // Tencent CAM does not auto-fetch the issuer's JWKS — the signing public key
  // (JWKS JSON) must be pasted when creating the OIDC provider.
  jwks: string
}

export async function getTencentOidcInfo(teamId: string): Promise<TencentOidcInfo> {
  return call<TencentOidcInfo>('GET', `/teams/${teamId}/tencent-accounts/oidc-info`)
}

export async function bindTencentAccount(
  teamId: string,
  label: string,
  site: TencentSite,
  roleArn: string,
  providerId: string,
): Promise<TencentAccount> {
  const a = await call<TencentAccountResponse>(
    'POST',
    `/teams/${teamId}/tencent-accounts`,
    { label, site, roleArn, providerId },
    // Bind verifies the role is assumable via STS before storing — give it
    // sweep-level headroom so a slow (e.g. proxied) route doesn't abort a bind.
    { retry: false, timeoutMs: 30_000 },
  )

  return {
    id: a.accountId,
    label: a.label,
    site: a.site ?? site,
    roleArn: a.roleArn,
    createdAt: a.createdAt,
  }
}

export async function unbindTencentAccount(teamId: string, accountId: string): Promise<void> {
  await call<void>('DELETE', `/teams/${teamId}/tencent-accounts/${accountId}`, undefined, {
    retry: false,
  })
}

type AliyunAccountResponse = {
  accountId: string
  label: string
  site?: AliyunSite
  roleArn: string
  createdAt?: string
}

export async function listAliyunAccounts(teamId: string): Promise<AliyunAccount[]> {
  const data = await call<{ accounts: AliyunAccountResponse[] }>(
    'GET',
    `/teams/${teamId}/aliyun-accounts`,
  )

  return (data.accounts ?? []).map((a) => ({
    id: a.accountId,
    label: a.label,
    site: a.site ?? 'china',
    roleArn: a.roleArn,
    createdAt: a.createdAt,
  }))
}

// OIDC federation details the customer needs to register Nuphos as a RAM OIDC
// identity provider and pin their role's trust policy: issuer URL, audience
// (client id), and this team's subject claim.
export type AliyunOidcInfo = {
  configured: boolean
  issuer: string
  audience: string
  subject: string
}

export async function getAliyunOidcInfo(teamId: string): Promise<AliyunOidcInfo> {
  return call<AliyunOidcInfo>('GET', `/teams/${teamId}/aliyun-accounts/oidc-info`)
}

export async function bindAliyunAccount(
  teamId: string,
  label: string,
  site: AliyunSite,
  roleArn: string,
  oidcProviderArn: string,
): Promise<AliyunAccount> {
  const a = await call<AliyunAccountResponse>(
    'POST',
    `/teams/${teamId}/aliyun-accounts`,
    { label, site, roleArn, oidcProviderArn },
    // Bind verifies the role is assumable via STS before storing — give it
    // sweep-level headroom so a slow (e.g. proxied) route doesn't abort a bind.
    { retry: false, timeoutMs: 30_000 },
  )

  return {
    id: a.accountId,
    label: a.label,
    site: a.site ?? site,
    roleArn: a.roleArn,
    createdAt: a.createdAt,
  }
}

export async function unbindAliyunAccount(teamId: string, accountId: string): Promise<void> {
  await call<void>('DELETE', `/teams/${teamId}/aliyun-accounts/${accountId}`, undefined, {
    retry: false,
  })
}

type VolcengineAccountResponse = {
  accountId: string
  label: string
  roleTrn: string
  createdAt?: string
}

export async function listVolcengineAccounts(teamId: string): Promise<VolcengineAccount[]> {
  const data = await call<{ accounts: VolcengineAccountResponse[] }>(
    'GET',
    `/teams/${teamId}/volcengine-accounts`,
  )

  return (data.accounts ?? []).map((a) => ({
    id: a.accountId,
    label: a.label,
    roleTrn: a.roleTrn,
    createdAt: a.createdAt,
  }))
}

// OIDC federation details the customer needs to register Nuphos as an IAM OIDC
// identity provider and pin their role's trust policy: issuer URL, audience
// (client id), and this team's subject claim.
export type VolcengineOidcInfo = {
  configured: boolean
  issuer: string
  audience: string
  subject: string
}

export async function getVolcengineOidcInfo(teamId: string): Promise<VolcengineOidcInfo> {
  return call<VolcengineOidcInfo>('GET', `/teams/${teamId}/volcengine-accounts/oidc-info`)
}

export async function bindVolcengineAccount(
  teamId: string,
  label: string,
  roleTrn: string,
): Promise<VolcengineAccount> {
  const a = await call<VolcengineAccountResponse>(
    'POST',
    `/teams/${teamId}/volcengine-accounts`,
    { label, roleTrn },
    // Bind verifies the role is assumable via STS before storing — give it the
    // same headroom as the list sweeps so a slow (e.g. proxied) route doesn't
    // abort a bind the backend then completes anyway.
    { retry: false, timeoutMs: 30_000 },
  )

  return { id: a.accountId, label: a.label, roleTrn: a.roleTrn, createdAt: a.createdAt }
}

export async function unbindVolcengineAccount(teamId: string, accountId: string): Promise<void> {
  await call<void>('DELETE', `/teams/${teamId}/volcengine-accounts/${accountId}`, undefined, {
    retry: false,
  })
}

// Huawei Cloud lives in ./huawei-accounts.
