import { generateKeyPairSync } from 'node:crypto'

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import * as configActual from '@/config'

const TEAM_ID = '68b0f1f77bcf86cd79943901'
const OTHER_TEAM_ID = '68b0f1f77bcf86cd79943902'
const IDENTITY = {
  domainId: '0a1b2c3d4e5f60718293a4b5c6d7e8f9',
  idpId: 'nuphos',
  agencyName: 'nuphos-readonly',
}

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

const realConfig = { ...configActual.config }
const realByos = { ...configActual.config.byos }
const configModuleSnapshot = { ...configActual }

// Federation is off unless a test turns it on.
let oidcKey: string | undefined

await mock.module('@/config', () => ({
  ...configActual,
  config: {
    ...realConfig,
    byos: {
      ...realByos,
      get aws() {
        return {
          ...realByos.aws,
          oidc: {
            ...realByos.aws.oidc,
            issuer: 'https://api.nuphos.ai',
            privateKey: oidcKey,
            privateKeyBase64: undefined,
          },
        }
      },
    },
  },
}))

afterAll(async () => {
  await mock.module('@/config', () => configModuleSnapshot)
})

const { assumeHuaweiIdentity, huaweiOidcConfigured, huaweiOidcInfo, verifyHuaweiIdentity } =
  await import('@/lib/byos/huawei')

type Call = { url: string; headers: Record<string, string>; body: unknown }

const realFetch = globalThis.fetch
let calls: Call[] = []

function stubFetch(responder: (call: Call) => Response): void {
  globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
    const call: Call = {
      url: input.toString(),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(typeof init?.body === 'string' ? init.body : '{}'),
    }

    calls.push(call)

    return Promise.resolve(responder(call))
  }) as typeof globalThis.fetch
}

function validTrustPolicy(): string {
  return JSON.stringify({
    Version: '5.0',
    Statement: [
      {
        Action: ['sts:agencies:assumeWithOIDC'],
        Effect: 'Allow',
        Principal: {
          Federated: [`iam::${IDENTITY.domainId}:oidcProvider:${IDENTITY.idpId}`],
        },
        Condition: {
          StringEquals: {
            'oidc:iss': ['https://api.nuphos.ai'],
            'oidc:aud': ['iam.myhuaweicloud.com'],
            'oidc:sub': [`nuphos:team:${TEAM_ID}`],
          },
        },
      },
    ],
  })
}

/** The trust_policy ListAgenciesV5 returns; override per test to exercise rejections. */
let agencyTrustPolicy: string | null = null

/**
 * The happy path: STS hands back the assumed agency's temporary credentials,
 * and IAM lists that agency (with agencyTrustPolicy, if set) for the
 * post-assumption trust-policy check.
 */
function federationResponder(call: Call): Response {
  if (call.url.includes('/v5/agencies/assume-with-oidc')) {
    return Response.json({
      credentials: {
        access_key_id: 'AK',
        secret_access_key: 'SK',
        security_token: 'ST',
        expiration: '2026-09-22T04:00:00.000000Z',
      },
    })
  }

  return Response.json({
    agencies: agencyTrustPolicy
      ? [{ agency_name: IDENTITY.agencyName, trust_policy: agencyTrustPolicy }]
      : [],
  })
}

beforeEach(() => {
  calls = []
  oidcKey = privateKey
  agencyTrustPolicy = validTrustPolicy()
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('huaweiOidcInfo', () => {
  test('is the exact triple the customer registers on the identity provider', () => {
    expect(huaweiOidcInfo(TEAM_ID)).toEqual({
      configured: true,
      issuer: 'https://api.nuphos.ai',
      audience: 'iam.myhuaweicloud.com',
      subject: `nuphos:team:${TEAM_ID}`,
    })
  })

  test('the subject is per team — the confused-deputy mitigation', () => {
    expect(huaweiOidcInfo(OTHER_TEAM_ID).subject).not.toBe(huaweiOidcInfo(TEAM_ID).subject)
  })

  test('reports unconfigured without the shared signing key', () => {
    oidcKey = undefined
    expect(huaweiOidcConfigured()).toBe(false)
    expect(huaweiOidcInfo(TEAM_ID).configured).toBe(false)
  })
})

describe('assumeHuaweiIdentity', () => {
  test('exchanges an ID token for the trust agency credentials in one call', async () => {
    stubFetch(federationResponder)

    const handle = await assumeHuaweiIdentity(IDENTITY, TEAM_ID)

    expect(handle.accessKeyId).toBe('AK')
    expect(handle.secretAccessKey).toBe('SK')
    expect(handle.securityToken).toBe('ST')
    expect(handle.expiresAt.toISOString()).toBe('2026-09-22T04:00:00.000Z')

    expect(calls).toHaveLength(1)
    const call = calls[0]

    expect(call?.url).toBe('https://sts.cn-north-4.myhuaweicloud.com/v5/agencies/assume-with-oidc')
    const body = call?.body as {
      agency_session_name: string
      agency_urn: string
      provider_urn: string
      id_token: string
      duration_seconds: number
    }

    // The provider and agency URNs are built from the account id + the
    // customer-chosen names — get either wrong and Huawei can't resolve the
    // provider or the agency at all (confirmed live: the provider URN uses
    // the identity provider's name, not its separate hex provider_id).
    expect(body.provider_urn).toBe(`iam::${IDENTITY.domainId}:oidcProvider:${IDENTITY.idpId}`)
    expect(body.agency_urn).toBe(`iam::${IDENTITY.domainId}:agency:${IDENTITY.agencyName}`)
    expect(body.duration_seconds).toBe(3600)

    // The ID token is the credential — signed by the shared Nuphos issuer for
    // this team and no other.
    const claims = JSON.parse(
      Buffer.from(body.id_token.split('.')[1] ?? '', 'base64url').toString(),
    ) as { iss: string; sub: string; aud: string }

    expect(claims).toMatchObject({
      iss: 'https://api.nuphos.ai',
      sub: `nuphos:team:${TEAM_ID}`,
      aud: 'iam.myhuaweicloud.com',
    })
  })

  test('fails without minting a token when the connector is unconfigured', async () => {
    oidcKey = undefined
    stubFetch(federationResponder)

    await expect(assumeHuaweiIdentity(IDENTITY, TEAM_ID)).rejects.toThrow(/not configured/)
    expect(calls).toHaveLength(0)
  })

  test('surfaces a rejected ID token', async () => {
    stubFetch(() => Response.json({ error_msg: 'invalid oidc id token' }, { status: 400 }))

    await expect(assumeHuaweiIdentity(IDENTITY, TEAM_ID)).rejects.toThrow(/invalid oidc id token/)
    expect(calls).toHaveLength(1)
  })
})

describe('verifyHuaweiIdentity', () => {
  test('uses a short session and accepts an identity provider whose agency trusts only this team', async () => {
    stubFetch(federationResponder)
    await verifyHuaweiIdentity(IDENTITY, TEAM_ID)

    expect(calls).toHaveLength(2)
    const assume = calls[0]?.body as { duration_seconds: number }

    expect(assume.duration_seconds).toBe(900)

    // The trust-policy check is signed with the just-assumed session, not the
    // unsigned STS call — it must carry an Authorization header STS never gets.
    const list = calls[1]

    expect(list?.url).toContain('https://iam.myhuaweicloud.com/v5/agencies')
    expect(list?.headers.Authorization).toContain('Access=AK')
    expect(list?.headers['X-Security-Token']).toBe('ST')
  })

  test('turns an upstream rejection into actionable bind-time guidance', async () => {
    stubFetch(() => Response.json({ error_msg: 'invalid audience' }, { status: 400 }))

    await expect(verifyHuaweiIdentity(IDENTITY, TEAM_ID)).rejects.toThrow(
      /identity provider "nuphos".*audience iam\.myhuaweicloud\.com.*trust agency named "nuphos-readonly"/su,
    )
  })

  test('rejects a trust policy with no oidc:sub condition at all', async () => {
    agencyTrustPolicy = JSON.stringify({
      Version: '5.0',
      Statement: [
        {
          Action: ['sts:agencies:assumeWithOIDC'],
          Effect: 'Allow',
          Principal: { Federated: [`iam::${IDENTITY.domainId}:oidcProvider:${IDENTITY.idpId}`] },
        },
      ],
    })
    stubFetch(federationResponder)

    await expect(verifyHuaweiIdentity(IDENTITY, TEAM_ID)).rejects.toThrow(
      /does not condition its trust policy on oidc:sub/,
    )
  })

  test('rejects a trust policy whose oidc:sub is broader than this team alone', async () => {
    agencyTrustPolicy = JSON.stringify({
      Version: '5.0',
      Statement: [
        {
          Action: ['sts:agencies:assumeWithOIDC'],
          Effect: 'Allow',
          Principal: { Federated: [`iam::${IDENTITY.domainId}:oidcProvider:${IDENTITY.idpId}`] },
          Condition: {
            StringEquals: {
              'oidc:sub': [`nuphos:team:${TEAM_ID}`, `nuphos:team:${OTHER_TEAM_ID}`],
            },
          },
        },
      ],
    })
    stubFetch(federationResponder)

    await expect(verifyHuaweiIdentity(IDENTITY, TEAM_ID)).rejects.toThrow(
      /does not condition its trust policy on oidc:sub/,
    )
  })

  test("rejects a trust policy conditioned on a different team's subject", async () => {
    agencyTrustPolicy = JSON.stringify({
      Version: '5.0',
      Statement: [
        {
          Action: ['sts:agencies:assumeWithOIDC'],
          Effect: 'Allow',
          Principal: { Federated: [`iam::${IDENTITY.domainId}:oidcProvider:${IDENTITY.idpId}`] },
          Condition: { StringEquals: { 'oidc:sub': [`nuphos:team:${OTHER_TEAM_ID}`] } },
        },
      ],
    })
    stubFetch(federationResponder)

    await expect(verifyHuaweiIdentity(IDENTITY, TEAM_ID)).rejects.toThrow(
      /does not condition its trust policy on oidc:sub/,
    )
  })

  test('rejects when the agency cannot be found to verify its trust policy', async () => {
    agencyTrustPolicy = null
    stubFetch(federationResponder)

    await expect(verifyHuaweiIdentity(IDENTITY, TEAM_ID)).rejects.toThrow(
      /Could not find trust agency "nuphos-readonly"/,
    )
  })

  test('rejects a policy that also has a broad allow alongside a correctly-restricted one', async () => {
    // A narrow, correctly-restricted statement is not enough if another
    // statement also grants the same shared provider unconditionally —
    // policy evaluation is a union of every Allow path.
    const providerUrn = `iam::${IDENTITY.domainId}:oidcProvider:${IDENTITY.idpId}`

    agencyTrustPolicy = JSON.stringify({
      Version: '5.0',
      Statement: [
        {
          Action: ['sts:agencies:assumeWithOIDC'],
          Effect: 'Allow',
          Principal: { Federated: [providerUrn] },
          Condition: { StringEquals: { 'oidc:sub': [`nuphos:team:${TEAM_ID}`] } },
        },
        {
          Action: ['sts:agencies:assumeWithOIDC'],
          Effect: 'Allow',
          Principal: { Federated: [providerUrn] },
        },
      ],
    })
    stubFetch(federationResponder)

    await expect(verifyHuaweiIdentity(IDENTITY, TEAM_ID)).rejects.toThrow(
      /does not condition its trust policy on oidc:sub/,
    )
  })

  test('rejects a wildcard action grant (sts:agencies:*) with no sub condition', async () => {
    const providerUrn = `iam::${IDENTITY.domainId}:oidcProvider:${IDENTITY.idpId}`

    agencyTrustPolicy = JSON.stringify({
      Version: '5.0',
      Statement: [
        {
          Action: ['sts:agencies:assumeWithOIDC'],
          Effect: 'Allow',
          Principal: { Federated: [providerUrn] },
          Condition: { StringEquals: { 'oidc:sub': [`nuphos:team:${TEAM_ID}`] } },
        },
        {
          // Broader than the specific action, but still grants it — must
          // count as an applicable statement, not be ignored for lacking an
          // exact string match.
          Action: ['sts:agencies:*'],
          Effect: 'Allow',
          Principal: { Federated: [providerUrn] },
        },
      ],
    })
    stubFetch(federationResponder)

    await expect(verifyHuaweiIdentity(IDENTITY, TEAM_ID)).rejects.toThrow(
      /does not condition its trust policy on oidc:sub/,
    )
  })

  test.each([['sts:*'], ['*']])(
    'rejects a broader wildcard action grant (%s) with no sub condition',
    async (action) => {
      const providerUrn = `iam::${IDENTITY.domainId}:oidcProvider:${IDENTITY.idpId}`

      agencyTrustPolicy = JSON.stringify({
        Version: '5.0',
        Statement: [
          {
            Action: ['sts:agencies:assumeWithOIDC'],
            Effect: 'Allow',
            Principal: { Federated: [providerUrn] },
            Condition: { StringEquals: { 'oidc:sub': [`nuphos:team:${TEAM_ID}`] } },
          },
          {
            Action: [action],
            Effect: 'Allow',
            Principal: { Federated: [providerUrn] },
          },
        ],
      })
      stubFetch(federationResponder)

      await expect(verifyHuaweiIdentity(IDENTITY, TEAM_ID)).rejects.toThrow(
        /does not condition its trust policy on oidc:sub/,
      )
    },
  )

  test('rejects a policy carrying a Deny statement for this provider', async () => {
    const providerUrn = `iam::${IDENTITY.domainId}:oidcProvider:${IDENTITY.idpId}`

    agencyTrustPolicy = JSON.stringify({
      Version: '5.0',
      Statement: [
        {
          Action: ['sts:agencies:assumeWithOIDC'],
          Effect: 'Allow',
          Principal: { Federated: [providerUrn] },
          Condition: { StringEquals: { 'oidc:sub': [`nuphos:team:${TEAM_ID}`] } },
        },
        {
          Action: ['sts:agencies:assumeWithOIDC'],
          Effect: 'Deny',
          Principal: { Federated: [providerUrn] },
        },
      ],
    })
    stubFetch(federationResponder)

    await expect(verifyHuaweiIdentity(IDENTITY, TEAM_ID)).rejects.toThrow(
      /does not condition its trust policy on oidc:sub/,
    )
  })
})
