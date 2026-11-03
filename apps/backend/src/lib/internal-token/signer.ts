import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'

import { GetPublicKeyCommand, KMSClient, SignCommand } from '@aws-sdk/client-kms'

import type { KeyObject } from 'node:crypto'

/**
 * Signs internal tokens with ES256. Production holds the P-256 private key in
 * AWS KMS, so it never enters this process; self-hosted installs can use a
 * local key file instead.
 */
export type InternalTokenSigner = {
  /** Raw `r || s` (64 bytes) ES256 signature over a JWS signing input. */
  sign: (signingInput: string) => Promise<Buffer>
  publicKey: () => Promise<KeyObject>
}

const P256_COMPONENT_BYTES = 32

/** A stable key id derived from the public key, so a rotation yields a new kid. */
export function keyIdOf(publicKey: KeyObject): string {
  const der = publicKey.export({ type: 'spki', format: 'der' })

  return createHash('sha256').update(der).digest('base64url').slice(0, 16)
}

export function assertP256(publicKey: KeyObject, source: string): void {
  if (
    publicKey.asymmetricKeyType !== 'ec' ||
    publicKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
  ) {
    throw new Error(`${source} must be a P-256 (ES256) key`)
  }
}

export function localSigner(privateKeyPem: string): InternalTokenSigner {
  const privateKey = createPrivateKey(privateKeyPem)
  const publicKey = createPublicKey(privateKey)

  assertP256(publicKey, 'NUPHOS_INTERNAL_TOKEN_PRIVATE_KEY_BASE64')

  return {
    sign: (signingInput) =>
      Promise.resolve(
        sign('sha256', Buffer.from(signingInput), { key: privateKey, dsaEncoding: 'ieee-p1363' }),
      ),
    publicKey: () => Promise.resolve(publicKey),
  }
}

/** Reads one DER INTEGER at `offset`; returns its unsigned big-endian value and the next offset. */
function readDerInteger(der: Buffer, offset: number): { value: Buffer; next: number } {
  if (der[offset] !== 0x02) throw new Error('ECDSA signature: expected INTEGER')
  const length = der[offset + 1]

  if (length === undefined || length > 0x7f) throw new Error('ECDSA signature: bad INTEGER length')
  const start = offset + 2
  let value = der.subarray(start, start + length)

  while (value.length > 1 && value[0] === 0) value = value.subarray(1)

  return { value, next: start + length }
}

/** KMS returns a DER `ECDSA-Sig-Value`; JWS needs the fixed-width `r || s` form. */
export function derToJoseEs256(der: Buffer): Buffer {
  if (der[0] !== 0x30) throw new Error('ECDSA signature: expected SEQUENCE')
  // P-256 signatures are at most 72 bytes, so the SEQUENCE uses a short-form length.
  const r = readDerInteger(der, 2)
  const s = readDerInteger(der, r.next)
  const out = Buffer.alloc(P256_COMPONENT_BYTES * 2)

  for (const [index, part] of [r.value, s.value].entries()) {
    if (part.length > P256_COMPONENT_BYTES) throw new Error('ECDSA signature: component too long')
    part.copy(out, (index + 1) * P256_COMPONENT_BYTES - part.length)
  }

  return out
}

type KmsLike = Pick<KMSClient, 'send'>

export function kmsSigner(keyId: string, client: KmsLike): InternalTokenSigner {
  let cached: Promise<KeyObject> | undefined

  return {
    sign: async (signingInput) => {
      const response = await client.send(
        new SignCommand({
          KeyId: keyId,
          Message: createHash('sha256').update(signingInput).digest(),
          MessageType: 'DIGEST',
          SigningAlgorithm: 'ECDSA_SHA_256',
        }),
      )

      if (!response.Signature) throw new Error('KMS Sign returned no signature')

      return derToJoseEs256(Buffer.from(response.Signature))
    },
    publicKey: () => {
      cached ??= client
        .send(new GetPublicKeyCommand({ KeyId: keyId }))
        .then((response) => {
          if (!response.PublicKey) throw new Error('KMS GetPublicKey returned no key')
          const publicKey = createPublicKey({
            key: Buffer.from(response.PublicKey),
            format: 'der',
            type: 'spki',
          })

          assertP256(publicKey, 'NUPHOS_INTERNAL_TOKEN_KMS_KEY_ID')

          return publicKey
        })
        .catch((error: unknown) => {
          cached = undefined
          throw error
        })

      return cached
    },
  }
}

export function awsKmsSigner(keyId: string, region: string | undefined): InternalTokenSigner {
  // Credentials come from the default chain (the pod's IAM role in production).
  return kmsSigner(keyId, new KMSClient(region ? { region } : {}))
}
