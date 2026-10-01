import { createHash, randomBytes } from 'node:crypto'

import { describe, expect, test, beforeAll } from 'bun:test'

// config.ts requires JWT env at import; set the minimum so the token
// helpers (which read config.auth.jwtSecret) can be exercised in isolation.
beforeAll(() => {
  process.env.NUPHOS_JWT_SECRET ??= 'test-secret-for-oauth-unit-tests'
  process.env.NUPHOS_PUBLIC_URL ??= 'https://api.nuphos.test'
})

describe('metadata', () => {
  test('protected-resource + AS metadata are consistent and PKCE-required', async () => {
    const { buildProtectedResourceMetadata, buildAuthorizationServerMetadata, mcpResourceUrl } =
      await import('./metadata')
    const base = 'https://api.nuphos.test'

    const prm = buildProtectedResourceMetadata(base) as any

    expect(prm.resource).toBe(mcpResourceUrl(base))
    expect(prm.resource).toBe(`${base}/mcp`)
    expect(prm.authorization_servers).toEqual([base])

    const as = buildAuthorizationServerMetadata(base) as any

    expect(as.issuer).toBe(base)
    expect(as.authorization_endpoint).toBe(`${base}/oauth/authorize`)
    expect(as.token_endpoint).toBe(`${base}/oauth/token`)
    expect(as.registration_endpoint).toBe(`${base}/oauth/register`)
    expect(as.code_challenge_methods_supported).toEqual(['S256'])
    expect(as.token_endpoint_auth_methods_supported).toEqual(['none'])
    expect(as.grant_types_supported).toContain('authorization_code')
    expect(as.grant_types_supported).toContain('refresh_token')
  })

  test('authorize endpoint can live on a separate browser-facing base', async () => {
    const { buildAuthorizationServerMetadata } = await import('./metadata')
    const as = buildAuthorizationServerMetadata(
      'https://api.nuphos.test',
      'https://nuphos.test',
    ) as any

    expect(as.issuer).toBe('https://api.nuphos.test')
    expect(as.authorization_endpoint).toBe('https://nuphos.test/oauth/authorize')
    expect(as.token_endpoint).toBe('https://api.nuphos.test/oauth/token')
    expect(as.registration_endpoint).toBe('https://api.nuphos.test/oauth/register')
  })
})

describe('PKCE (S256)', () => {
  test('accepts a matching verifier/challenge pair', async () => {
    const { verifyPkceS256 } = await import('./tokens')
    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')

    expect(verifyPkceS256(verifier, challenge)).toBe(true)
  })

  test('rejects a wrong verifier and empty inputs', async () => {
    const { verifyPkceS256 } = await import('./tokens')
    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')

    expect(verifyPkceS256('not-the-verifier', challenge)).toBe(false)
    expect(verifyPkceS256('', challenge)).toBe(false)
    expect(verifyPkceS256(verifier, '')).toBe(false)
  })
})

describe('consent token (cookie one-click authorize CSRF guard)', () => {
  test('round-trips when bound to the same user + client', async () => {
    const { signConsentToken, verifyConsentToken } = await import('./tokens')
    const token = signConsentToken({ userId: 'user-1', clientId: 'mcp_abc', ttlSec: 300 })

    expect(verifyConsentToken(token, 'user-1', 'mcp_abc')).toBe(true)
  })

  test('rejects a different user, different client, expiry, and tampering', async () => {
    const { signConsentToken, verifyConsentToken } = await import('./tokens')
    const token = signConsentToken({ userId: 'user-1', clientId: 'mcp_abc', ttlSec: 300 })

    expect(verifyConsentToken(token, 'user-2', 'mcp_abc')).toBe(false)
    expect(verifyConsentToken(token, 'user-1', 'mcp_other')).toBe(false)

    const expired = signConsentToken({ userId: 'user-1', clientId: 'mcp_abc', ttlSec: -1 })

    expect(verifyConsentToken(expired, 'user-1', 'mcp_abc')).toBe(false)

    const tampered = token.slice(0, -2) + (token.endsWith('a') ? 'bb' : 'aa')

    expect(verifyConsentToken(tampered, 'user-1', 'mcp_abc')).toBe(false)
    expect(verifyConsentToken('garbage', 'user-1', 'mcp_abc')).toBe(false)
  })
})

describe('access token', () => {
  const base = 'https://api.nuphos.test'
  const resource = `${base}/mcp`

  test('round-trips and binds to subject + audience', async () => {
    const { signAccessToken, verifyAccessToken } = await import('./tokens')
    const token = signAccessToken({
      userId: 'user-123',
      clientId: 'mcp_abc',
      resource,
      issuer: base,
      ttlSec: 3600,
    })
    const claims = verifyAccessToken(token, resource, base)

    expect(claims?.sub).toBe('user-123')
    expect(claims?.aud).toBe(resource)
    expect(claims?.scope).toBe('mcp')
  })

  test('rejects a token for a different resource (audience binding)', async () => {
    const { signAccessToken, verifyAccessToken } = await import('./tokens')
    const token = signAccessToken({
      userId: 'user-123',
      clientId: 'mcp_abc',
      resource,
      issuer: base,
      ttlSec: 3600,
    })

    expect(verifyAccessToken(token, 'https://evil.test/mcp', base)).toBeNull()
  })

  test('rejects a token minted by a different issuer (issuer binding)', async () => {
    const { signAccessToken, verifyAccessToken } = await import('./tokens')
    const token = signAccessToken({
      userId: 'user-123',
      clientId: 'mcp_abc',
      resource,
      issuer: 'https://other-issuer.test',
      ttlSec: 3600,
    })

    expect(verifyAccessToken(token, resource, base)).toBeNull()
  })

  test('rejects an expired token and a tampered signature', async () => {
    const { signAccessToken, verifyAccessToken } = await import('./tokens')
    const expired = signAccessToken({
      userId: 'u',
      clientId: 'mcp_abc',
      resource,
      issuer: base,
      ttlSec: -1,
    })

    expect(verifyAccessToken(expired, resource, base)).toBeNull()

    const good = signAccessToken({
      userId: 'u',
      clientId: 'mcp_abc',
      resource,
      issuer: base,
      ttlSec: 3600,
    })
    const tampered = good.slice(0, -2) + (good.endsWith('a') ? 'bb' : 'aa')

    expect(verifyAccessToken(tampered, resource, base)).toBeNull()
  })

  test('a raw Nuphos-style token is not accepted as an MCP token', async () => {
    const { verifyAccessToken } = await import('./tokens')

    // Missing the `from: 'mcp'` claim / wrong signature → rejected.
    expect(verifyAccessToken('a.b.c', resource, base)).toBeNull()
  })
})
