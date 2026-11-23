// The Vault formats, byte for byte the CLI's (`apps/cli/src/vault.rs`), so a
// Desktop device and a CLI device open each other's items. Item keys are
// wrapped per device with HPKE base mode (RFC 9180: DHKEM X25519, HKDF-SHA256,
// AES-256-GCM); values are sealed with AES-256-GCM under the item key.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  randomBytes,
} from 'node:crypto'

import type { KeyObject } from 'node:crypto'

const WRAP_INFO = Buffer.from('nuphos-vault/v1 item-key')
const ITEM_AAD = 'nuphos-vault/v1 item:'

export const MAX_VALUE = 64 * 1024

// DER prefixes that turn a raw 32-byte X25519 key into PKCS#8 / SPKI.
const PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex')
const SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex')

const privateKeyOf = (raw: Buffer) =>
  createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, raw]), format: 'der', type: 'pkcs8' })
const publicKeyOf = (raw: Buffer) =>
  createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' })
const rawPublic = (key: KeyObject) =>
  key.export({ format: 'der', type: 'spki' }).subarray(SPKI_PREFIX.length)

/** A new device key: the raw private and public halves. */
export function generateDeviceKey(): { privateKey: Buffer; publicKey: Buffer } {
  const { privateKey, publicKey } = generateKeyPairSync('x25519')

  return {
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(PKCS8_PREFIX.length),
    publicKey: rawPublic(publicKey),
  }
}

export function publicKeyFromPrivate(privateKey: Buffer): Buffer {
  return rawPublic(createPublicKey(privateKeyOf(privateKey)))
}

/** What a person compares on both screens before approving a device. */
export function fingerprint(publicKey: Buffer): string {
  const hex = createHash('sha256').update(publicKey).digest('hex').toUpperCase()

  return [0, 4, 8, 12, 16].map((at) => hex.slice(at, at + 4)).join('-')
}

/** The backend's rule, checked here so a name never changes the URL path. */
export function validName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)
}

// --- HPKE base mode, single shot (RFC 9180 §4, §5.1, §6.1) ---

const KEM_SUITE = Buffer.from('KEM\x00\x20', 'latin1')
const HPKE_SUITE = Buffer.from('HPKE\x00\x20\x00\x01\x00\x02', 'latin1')
const VERSION = Buffer.from('HPKE-v1')

const hmac = (key: Buffer, data: Buffer) => createHmac('sha256', key).update(data).digest()

function labeledExtract(suite: Buffer, salt: Buffer, label: string, ikm: Buffer): Buffer {
  return hmac(
    salt.length ? salt : Buffer.alloc(32),
    Buffer.concat([VERSION, suite, Buffer.from(label), ikm]),
  )
}

// Every output here is at most one SHA-256 block, so HKDF-Expand is one HMAC.
function labeledExpand(
  suite: Buffer,
  prk: Buffer,
  label: string,
  info: Buffer,
  length: number,
): Buffer {
  const lengthPrefix = Buffer.from([length >> 8, length & 0xff])
  const block = Buffer.concat([
    lengthPrefix,
    VERSION,
    suite,
    Buffer.from(label),
    info,
    Buffer.from([1]),
  ])

  return hmac(prk, block).subarray(0, length)
}

function keySchedule(dh: Buffer, enc: Buffer, recipient: Buffer) {
  const empty = Buffer.alloc(0)
  const eaePrk = labeledExtract(KEM_SUITE, empty, 'eae_prk', dh)
  const shared = labeledExpand(
    KEM_SUITE,
    eaePrk,
    'shared_secret',
    Buffer.concat([enc, recipient]),
    32,
  )
  const context = Buffer.concat([
    Buffer.from([0]),
    labeledExtract(HPKE_SUITE, empty, 'psk_id_hash', empty),
    labeledExtract(HPKE_SUITE, empty, 'info_hash', WRAP_INFO),
  ])
  const secret = labeledExtract(HPKE_SUITE, shared, 'secret', empty)

  return {
    key: labeledExpand(HPKE_SUITE, secret, 'key', context, 32),
    nonce: labeledExpand(HPKE_SUITE, secret, 'base_nonce', context, 12),
  }
}

function gcmSeal(key: Buffer, nonce: Buffer, aad: Buffer, plain: Buffer): Buffer {
  const cipher = createCipheriv('aes-256-gcm', key, nonce).setAAD(aad)

  return Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()])
}

function gcmOpen(key: Buffer, nonce: Buffer, aad: Buffer, sealed: Buffer): Buffer {
  if (sealed.length < 16) throw new Error('too short')
  const decipher = createDecipheriv('aes-256-gcm', key, nonce).setAAD(aad)

  decipher.setAuthTag(sealed.subarray(sealed.length - 16))

  return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()])
}

/** Wraps an item key for one device; the item name is bound as associated data. */
export function wrap(itemKey: Buffer, name: string, to: Buffer): string {
  const ephemeral = generateKeyPairSync('x25519')
  const enc = rawPublic(ephemeral.publicKey)
  const dh = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: publicKeyOf(to) })
  const { key, nonce } = keySchedule(dh, enc, to)

  return Buffer.concat([enc, gcmSeal(key, nonce, Buffer.from(name), itemKey)]).toString('base64')
}

export function unwrap(wrapped: string, name: string, privateKey: Buffer): Buffer {
  const bytes = Buffer.from(wrapped, 'base64')
  const enc = bytes.subarray(0, 32)
  const own = privateKeyOf(privateKey)
  const dh = diffieHellman({ privateKey: own, publicKey: publicKeyOf(enc) })
  const { key, nonce } = keySchedule(dh, enc, rawPublic(createPublicKey(own)))

  return gcmOpen(key, nonce, Buffer.from(name), bytes.subarray(32))
}

export function seal(itemKey: Buffer, name: string, value: Buffer): string {
  const nonce = randomBytes(12)

  return Buffer.concat([
    nonce,
    gcmSeal(itemKey, nonce, Buffer.from(ITEM_AAD + name), value),
  ]).toString('base64')
}

export function open(itemKey: Buffer, name: string, ciphertext: string): Buffer {
  const bytes = Buffer.from(ciphertext, 'base64')

  return gcmOpen(itemKey, bytes.subarray(0, 12), Buffer.from(ITEM_AAD + name), bytes.subarray(12))
}
