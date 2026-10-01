import { beforeEach, describe, expect, test } from 'bun:test'

import { verifyGcpWifImpersonation } from '@/lib/byos/gcp-iam-http'
import { useByosGcp } from '@/lib/test/doubles/byos-gcp'
import { useByosGcpWif } from '@/lib/test/doubles/byos-gcp-wif'

const TEAM_ID = '68b0f1f77bcf86cd79943901'
const CUSTOMER_SA = 'nuphos@customer-project.iam.gserviceaccount.com'
const PRINCIPAL = `principal://iam.googleapis.com/projects/1/locations/global/workloadIdentityPools/nuphos/subject/nuphos:team:${TEAM_ID}`

useByosGcpWif({
  gcpWifConfigured: () => true,
  gcpWifPrincipalForTeam: () => PRINCIPAL,
})

const installGcp = useByosGcp({})

beforeEach(() => {
  installGcp({
    impersonateSa: () => ({
      getAccessToken: () => Promise.resolve({ token: 'test-token' }),
    }),
  })
})

describe('verifyGcpWifImpersonation', () => {
  test('accepts a service account the team WIF principal can impersonate', async () => {
    let calls = 0

    installGcp({
      impersonateSa: () => {
        calls++

        return { getAccessToken: () => Promise.resolve({ token: 'test-token' }) }
      },
    })

    await verifyGcpWifImpersonation(CUSTOMER_SA, TEAM_ID)
    expect(calls).toBe(1)
  })

  test('retries while a new Token Creator grant propagates', async () => {
    let calls = 0

    installGcp({
      impersonateSa: () => {
        calls++
        if (calls <= 2) throw new Error('Permission iam.serviceAccounts.getAccessToken denied')

        return { getAccessToken: () => Promise.resolve({ token: 'test-token' }) }
      },
    })

    await verifyGcpWifImpersonation(CUSTOMER_SA, TEAM_ID, [1, 1, 1, 1])
    expect(calls).toBe(3)
  })

  test('names the exact team-scoped WIF principal when the grant is missing', async () => {
    installGcp({
      impersonateSa: () => {
        throw new Error('Permission iam.serviceAccounts.getAccessToken denied')
      },
    })

    const err = await verifyGcpWifImpersonation(CUSTOMER_SA, TEAM_ID, [1, 1]).then(
      () => null,
      (e: unknown) => e as Error,
    )

    expect(err?.message).toContain(CUSTOMER_SA)
    expect(err?.message).toContain(PRINCIPAL)
    expect(err?.message).toContain('up to a minute')
  })
})
