import { generateKeyPairSync } from 'node:crypto'

export type EphemeralSshKey = {
  privateKeyPem: string
  publicKeyOpenSsh: string
}

function lenPrefixed(buf: Buffer): Buffer {
  const len = Buffer.alloc(4)

  len.writeUInt32BE(buf.length, 0)

  return Buffer.concat([len, buf])
}

function mpint(buf: Buffer): Buffer {
  // Drop leading zero bytes, then add one back if the high bit is set so the
  // value is treated as positive per RFC 4251 §5.
  let i = 0

  while (i < buf.length - 1 && buf[i] === 0) i++
  let trimmed = buf.subarray(i)

  if (trimmed[0]! & 0x80) trimmed = Buffer.concat([Buffer.from([0]), trimmed])

  return lenPrefixed(trimmed)
}

function b64urlToBuf(s: string): Buffer {
  const pad = 4 - (s.length % 4 || 4)
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad)

  return Buffer.from(padded, 'base64')
}

// Generates an ephemeral RSA SSH keypair. Returns the private key as a PKCS8
// PEM (works with /usr/bin/ssh -i) and the public key in OpenSSH `ssh-rsa`
// wire format suitable for AWS EC2 Instance Connect / GCP OS Login.
export function generateEphemeralSshKey(comment = 'nuphos'): EphemeralSshKey {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072 })

  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' })

  // Convert SPKI public key into the OpenSSH wire format via JWK.
  const jwk = publicKey.export({ format: 'jwk' }) as { n?: string; e?: string }

  if (!jwk.n || !jwk.e) throw new Error('Failed to export RSA public key as JWK')
  const wire = Buffer.concat([
    lenPrefixed(Buffer.from('ssh-rsa')),
    mpint(b64urlToBuf(jwk.e)),
    mpint(b64urlToBuf(jwk.n)),
  ])
  const publicKeyOpenSsh = `ssh-rsa ${wire.toString('base64')} ${comment}`

  return { privateKeyPem, publicKeyOpenSsh }
}
