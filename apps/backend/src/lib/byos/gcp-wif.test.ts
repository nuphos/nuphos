import { generateKeyPairSync } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

import * as configActual from '@/config'

// The pool lives in Nuphos's own GCP project, so these are deploy constants
// rather than anything a customer supplies.
const PROJECT_NUMBER = '548156476377'
const POOL_ID = 'nuphos'
const PROVIDER_ID = 'nuphos-oidc'
const TEAM_ID = '68b0f1f77bcf86cd79943901'
const OTHER_TEAM_ID = '68b0f1f77bcf86cd79943902'
const CUSTOMER_SA = 'nuphos@customer-project.iam.gserviceaccount.com'

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

const realConfig = { ...configActual.config }
const realByos = { ...configActual.config.byos }
const configModuleSnapshot = { ...configActual }

// Federation is off unless a test turns it on.
const wifOverrides: {
  projectNumber?: string
  poolId?: string
  providerId?: string
} = {}
let oidcKey: string | undefined

// Getters, not a snapshot: the module factory runs once, so a plain object would
// freeze whatever the overrides happened to be at import time and every test
// would see the same (empty) config.
await mock.module('@/config', () => ({
  ...configActual,
  config: {
    ...realConfig,
    byos: {
      ...realByos,
      get aws() {
        return {
          ...realByos.aws,
          oidc: { ...realByos.aws.oidc, privateKey: oidcKey, privateKeyBase64: undefined },
        }
      },
      get gcp() {
        return {
          ...realByos.gcp,
          wif: {
            projectNumber: wifOverrides.projectNumber,
            poolId: wifOverrides.poolId,
            providerId: wifOverrides.providerId,
          },
        }
      },
    },
  },
}))

afterAll(async () => {
  await mock.module('@/config', () => configModuleSnapshot)
})

const { gcpWifAudience, gcpWifConfigured, gcpWifPrincipalForTeam, resetGcpWifClientsForTest } =
  await import('@/lib/byos/gcp-wif')
const { impersonateSa } = await import('@/lib/byos/gcp')

function enableWif(): void {
  wifOverrides.projectNumber = PROJECT_NUMBER
  wifOverrides.poolId = POOL_ID
  wifOverrides.providerId = PROVIDER_ID
  oidcKey = privateKey
}

beforeEach(() => {
  delete wifOverrides.projectNumber
  delete wifOverrides.poolId
  delete wifOverrides.providerId
  oidcKey = undefined
  resetGcpWifClientsForTest()
})

describe('gcpWifConfigured', () => {
  test('is false until both the pool and the signing key are present', () => {
    expect(gcpWifConfigured()).toBe(false)

    wifOverrides.projectNumber = PROJECT_NUMBER
    wifOverrides.poolId = POOL_ID
    wifOverrides.providerId = PROVIDER_ID
    // Pool coordinates alone are useless: without the shared Nuphos signing key
    // there is no token to present to it.
    expect(gcpWifConfigured()).toBe(false)

    oidcKey = privateKey
    expect(gcpWifConfigured()).toBe(true)
  })
})

describe('the values customers paste', () => {
  // These two strings are the whole integration surface: the audience is what
  // Google matches the token against, and the principal is what the customer
  // types into "New principals". A change here silently breaks every new bind,
  // so they are pinned verbatim.
  test('audience is the provider resource path', () => {
    enableWif()
    expect(gcpWifAudience()).toBe(
      '//iam.googleapis.com/projects/548156476377/locations/global/workloadIdentityPools/nuphos/providers/nuphos-oidc',
    )
  })

  test('principal names the pool and this team, and no other', () => {
    enableWif()
    expect(gcpWifPrincipalForTeam(TEAM_ID)).toBe(
      `principal://iam.googleapis.com/projects/548156476377/locations/global/workloadIdentityPools/nuphos/subject/nuphos:team:${TEAM_ID}`,
    )
    // The per-team subject is the confused-deputy mitigation — Google refuses a
    // grant made for one team when presented another team's token — so the two
    // must never collapse to the same string.
    expect(gcpWifPrincipalForTeam(OTHER_TEAM_ID)).not.toBe(gcpWifPrincipalForTeam(TEAM_ID))
  })

  test('both fail loudly when federation is not configured', () => {
    expect(() => gcpWifAudience()).toThrow(/not configured/)
    expect(() => gcpWifPrincipalForTeam(TEAM_ID)).toThrow(/not configured/)
  })
})

const delegatesOf = (imp: unknown) => (imp as { delegates?: string[] }).delegates
const sourceClientOf = (imp: unknown) => (imp as { sourceClient?: unknown }).sourceClient

describe('impersonateSa', () => {
  test('impersonates directly from the team WIF client without delegates', async () => {
    enableWif()
    const imp = await impersonateSa(CUSTOMER_SA, TEAM_ID)

    expect(delegatesOf(imp)).toEqual([])
  })

  test('fails at the deploy boundary when WIF is unavailable', async () => {
    const err = await impersonateSa(CUSTOMER_SA, TEAM_ID).then(
      () => null,
      (e: unknown) => e as Error,
    )

    expect(err?.message).toContain('workload identity federation is not configured')
  })

  test('each team federates under its own client', async () => {
    enableWif()
    const mine = await impersonateSa(CUSTOMER_SA, TEAM_ID)
    const theirs = await impersonateSa(CUSTOMER_SA, OTHER_TEAM_ID)

    // Sharing one source client across teams would hand every team whichever
    // team's token happened to be minted first.
    expect(sourceClientOf(mine)).not.toBe(sourceClientOf(theirs))
  })
})
