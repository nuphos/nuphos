import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto'

import { GetPublicKeyCommand, SignCommand } from '@aws-sdk/client-kms'
import { afterAll, describe, expect, test } from 'bun:test'

import { config } from '@/config'
import { getAwsOidcJwks } from '@/lib/byos/aws-oidc'
import {
  mintPreviewMcpToken,
  redactSignedTokens,
  verifyPreviewMcpToken,
} from '@/lib/claude-code-preview/mcp-token'
import { internalWellKnownRoutes, wellKnownRoutes } from '@/routes/well-known'

import { derToJoseEs256, keyIdOf, kmsSigner, localSigner } from './signer'

import {
  internalJwks,
  internalTokenIssuer,
  setInternalTokenSignerForTest,
  signInternalToken,
  verifiedInternalPayload,
} from './index'

const ec = () => generateKeyPairSync('ec', { namedCurve: 'P-256' })
const pem = (key: ReturnType<typeof ec>['privateKey']) =>
  key.export({ type: 'pkcs8', format: 'pem' })

afterAll(() => setInternalTokenSignerForTest(null))

function header(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[0] ?? '', 'base64url').toString()) as Record<
    string,
    unknown
  >
}

describe('derToJoseEs256', () => {
  test('turns a DER ECDSA signature into a verifiable r || s signature', () => {
    const { privateKey, publicKey } = ec()

    for (let i = 0; i < 50; i++) {
      const message = Buffer.from(`message-${String(i)}`)
      const raw = derToJoseEs256(sign('sha256', message, privateKey))

      expect(raw).toHaveLength(64)
      expect(verify('sha256', message, { key: publicKey, dsaEncoding: 'ieee-p1363' }, raw)).toBe(
        true,
      )
    }
  })

  test('rejects malformed input', () => {
    expect(() => derToJoseEs256(Buffer.from([0x31, 0x00]))).toThrow()
  })
})

describe('internal tokens with a local key', () => {
  test('sign and verify, with iss and kid checked', async () => {
    const { privateKey, publicKey } = ec()

    await setInternalTokenSignerForTest(localSigner(pem(privateKey)))
    const token = await signInternalToken({ iss: internalTokenIssuer(), sub: 'u' })

    expect(token).not.toBeNull()
    expect(header(token!)).toEqual({ alg: 'ES256', typ: 'JWT', kid: keyIdOf(publicKey) })
    expect(verifiedInternalPayload(token!)).toMatchObject({ sub: 'u' })

    // Another issuer's claims, even when signed with the same key.
    const foreign = await signInternalToken({ iss: 'https://api.nuphos.ai', sub: 'u' })

    expect(verifiedInternalPayload(foreign!)).toBeNull()

    // A tampered payload.
    const [h, , s] = token!.split('.')
    const forged = Buffer.from(JSON.stringify({ iss: internalTokenIssuer(), sub: 'x' })).toString(
      'base64url',
    )

    expect(verifiedInternalPayload(`${h}.${forged}.${s}`)).toBeNull()
  })

  test('a key outside the internal JWKS is rejected', async () => {
    const other = ec()

    await setInternalTokenSignerForTest(localSigner(pem(other.privateKey)))
    const token = await signInternalToken({ iss: internalTokenIssuer() })

    await setInternalTokenSignerForTest(localSigner(pem(ec().privateKey)))
    expect(verifiedInternalPayload(token!)).toBeNull()
  })

  test('the JWKS publishes the active key as an ES256 signing key', async () => {
    const { privateKey, publicKey } = ec()

    await setInternalTokenSignerForTest(localSigner(pem(privateKey)))
    expect(internalJwks().keys).toEqual([
      expect.objectContaining({
        kty: 'EC',
        crv: 'P-256',
        alg: 'ES256',
        use: 'sig',
        kid: keyIdOf(publicKey),
      }),
    ])
  })

  test('without a signer nothing is signed', async () => {
    await setInternalTokenSignerForTest(null)
    expect(await signInternalToken({ iss: internalTokenIssuer() })).toBeNull()
    expect(internalJwks().keys).toEqual([])
  })
})

describe('internal tokens with an AWS KMS key', () => {
  test('signs a SHA-256 digest with ECDSA_SHA_256 and converts the DER signature', async () => {
    const { privateKey, publicKey } = ec()
    const signingInput = 'header.payload'
    const sent: unknown[] = []
    const client = {
      send: (command: unknown) => {
        sent.push(command)
        if (command instanceof GetPublicKeyCommand) {
          return Promise.resolve({ PublicKey: publicKey.export({ type: 'spki', format: 'der' }) })
        }

        // A real KMS key signs the digest; the test key signs the same input.
        return Promise.resolve({ Signature: sign('sha256', Buffer.from(signingInput), privateKey) })
      },
    }
    const signer = kmsSigner('arn:aws:kms:us-east-1:111122223333:key/test', client as never)

    expect(keyIdOf(await signer.publicKey())).toBe(keyIdOf(publicKey))
    const signature = await signer.sign(signingInput)

    expect(
      verify(
        'sha256',
        Buffer.from(signingInput),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        signature,
      ),
    ).toBe(true)
    const signCommand = sent.find((command) => command instanceof SignCommand)!

    expect(signCommand.input).toMatchObject({
      KeyId: 'arn:aws:kms:us-east-1:111122223333:key/test',
      MessageType: 'DIGEST',
      SigningAlgorithm: 'ECDSA_SHA_256',
    })
    expect(Buffer.from(signCommand.input.Message!)).toEqual(
      createHash('sha256').update(signingInput).digest(),
    )
  })

  test('rejects a KMS key that is not P-256', async () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const client = {
      send: () =>
        Promise.resolve({ PublicKey: rsa.publicKey.export({ type: 'spki', format: 'der' }) }),
    }

    await expect(kmsSigner('k', client as never).publicKey()).rejects.toThrow('P-256')
  })
})

describe('conversation tokens', () => {
  const args = { userId: 'user-1', sessionId: 'conv-1', teamId: 'team-1' }

  test('are ES256 from the internal issuer when a signer is configured', async () => {
    await setInternalTokenSignerForTest(localSigner(pem(ec().privateKey)))
    const token = await mintPreviewMcpToken({ ...args, actor: 'session:parent-1' })

    expect(header(token).alg).toBe('ES256')
    const claims = verifyPreviewMcpToken(token)

    expect(claims).toMatchObject({
      iss: internalTokenIssuer(),
      sid: 'conv-1',
      act: { sub: 'session:parent-1' },
    })
    expect(claims?.jti).toMatch(/^[0-9a-f-]{36}$/u)
    expect(redactSignedTokens(`token=${token}`)).toBe('token=[redacted]')
  })

  test('each mint gets its own jti', async () => {
    await setInternalTokenSignerForTest(localSigner(pem(ec().privateKey)))
    const a = verifyPreviewMcpToken(await mintPreviewMcpToken(args))
    const b = verifyPreviewMcpToken(await mintPreviewMcpToken(args))

    expect(a?.jti).not.toBe(b?.jti)
    expect(a?.act).toBeUndefined()
  })

  test('HS256 tokens minted before the switch still verify', async () => {
    await setInternalTokenSignerForTest(null)
    const legacy = await mintPreviewMcpToken(args)

    expect(header(legacy).alg).toBe('HS256')
    await setInternalTokenSignerForTest(localSigner(pem(ec().privateKey)))
    expect(verifyPreviewMcpToken(legacy)).toMatchObject({ sid: 'conv-1' })
  })
})

describe('issuer separation', () => {
  const oidc = config.byos.aws.oidc
  const original = { privateKey: oidc.privateKey, privateKeyBase64: oidc.privateKeyBase64 }

  afterAll(() => {
    Object.assign(oidc, original)
  })

  test('the internal key never appears in the cloud federation JWKS', async () => {
    const internal = ec()
    const cloud = generateKeyPairSync('rsa', { modulusLength: 2048 })

    Object.assign(oidc, {
      privateKey: cloud.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      privateKeyBase64: undefined,
    })
    await setInternalTokenSignerForTest(localSigner(pem(internal.privateKey)))
    const internalKid = keyIdOf(internal.publicKey)

    const cloudKids = (getAwsOidcJwks() as { keys: { kid: string }[] }).keys.map((key) => key.kid)
    const routeKids = (
      (await (await wellKnownRoutes.request('/jwks.json')).json()) as { keys: { kid: string }[] }
    ).keys.map((key) => key.kid)
    const internalRoute = (await (await internalWellKnownRoutes.request('/jwks.json')).json()) as {
      keys: { kid: string }[]
    }

    expect(cloudKids).not.toContain(internalKid)
    expect(routeKids).not.toContain(internalKid)
    expect(internalRoute.keys.map((key) => key.kid)).toEqual([internalKid])
  })

  test('the internal issuer is not the cloud federation issuer', () => {
    expect(internalTokenIssuer()).not.toBe(config.byos.aws.oidc.issuer ?? config.auth.publicBaseUrl)
  })
})
