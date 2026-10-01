import { call } from './client'

export type HuaweiAccount = {
  id: string
  label: string
  domainId: string
  idpId: string
  agencyName: string
  createdAt?: string
}

type HuaweiAccountResponse = {
  accountId: string
  label: string
  domainId: string
  idpId: string
  agencyName: string
  createdAt?: string
}

export async function listHuaweiAccounts(teamId: string): Promise<HuaweiAccount[]> {
  const data = await call<{ accounts: HuaweiAccountResponse[] }>(
    'GET',
    `/teams/${teamId}/huawei-accounts`,
  )

  return (data.accounts ?? []).map((a) => ({
    id: a.accountId,
    label: a.label,
    domainId: a.domainId,
    idpId: a.idpId,
    agencyName: a.agencyName,
    createdAt: a.createdAt,
  }))
}

// What the customer registers on their IAM identity provider.
export type HuaweiOidcInfo = {
  configured: boolean
  issuer: string
  audience: string
  subject: string
}

export async function getHuaweiOidcInfo(teamId: string): Promise<HuaweiOidcInfo> {
  return call<HuaweiOidcInfo>('GET', `/teams/${teamId}/huawei-accounts/oidc-info`)
}

export async function bindHuaweiAccount(
  teamId: string,
  label: string,
  domainId: string,
  idpId: string,
  agencyName: string,
): Promise<HuaweiAccount> {
  const a = await call<HuaweiAccountResponse>(
    'POST',
    `/teams/${teamId}/huawei-accounts`,
    { label, domainId, idpId, agencyName },
    // Bind federates once before storing to prove the identity provider works —
    // same headroom as the other verifying binds.
    { retry: false, timeoutMs: 30_000 },
  )

  return {
    id: a.accountId,
    label: a.label,
    domainId: a.domainId,
    idpId: a.idpId,
    agencyName: a.agencyName,
    createdAt: a.createdAt,
  }
}

export async function unbindHuaweiAccount(teamId: string, accountId: string): Promise<void> {
  await call<void>('DELETE', `/teams/${teamId}/huawei-accounts/${accountId}`, undefined, {
    retry: false,
  })
}
