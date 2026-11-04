// The Chrome Web Store signs a hash of every file in an extension
// (`_metadata/verified_contents.json`). Checking the files against it is what
// Chrome's content verification does, and it trusts no download host.
import { createHash, createPublicKey, verify } from 'node:crypto'

import type { KeyObject } from 'node:crypto'

/** Chromium's kWebstoreSignaturesPublicKey (extensions/browser/content_verifier/content_verifier_key.h). */
export const WEB_STORE_KEY = createPublicKey({
  key: Buffer.from(
    '30820122300d06092a864886f70d01010105000382010f003082010a0282010100' +
      '8ffbbf5c3763943cb0ee01c4b5a69ab19f46746f1638a0322735ddf0716b0edc' +
      'f625cbb2edeafb32d5af1e03430346f0a739db23961d65e57851f084b00e12ac' +
      '0e5bdcc9d64c7c00d5b81b88333e2fdaebaaf71a75c2ae3a54de378f10d228e6' +
      '84794d15b4f3bd3f56d33c3f18abfc2e05c01e0831b661d0fd9f4f3f640d1793' +
      'bcad41c748be0027a84d7042920554a66db8de566e204970ee103e6bd27c31bd' +
      '1b6ea43c46629f086693f92a5131a8dbb59db90f73e8a0093201e97b2a8a36a0' +
      'cf17b050709da2f9a46f624db6c931fcf30812ff93bd6231d81cea1a9ef58128' +
      '7f755ed2277ac296f59ddb18fc76dc46f057c05834c8222d2a6575a7d90862cd' +
      '0203010001',
    'hex',
  ),
  format: 'der',
  type: 'spki',
})

export const VERIFIED_CONTENTS_PATH = '_metadata/verified_contents.json'

export type SignedContents = {
  id: string
  version: string
  blockSize: number
  hashBlockSize: number
  /** Root tree hash (base64url) by file path. */
  roots: Map<string, string>
}

const SHA256_BYTES = 32

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest()

/** Chromium's tree hash: SHA-256 of each block, then of each group of hashes, up to one root. */
export function treeHashRoot(data: Uint8Array, blockSize: number, hashBlockSize: number): string {
  let level: Buffer[] = []

  for (let start = 0; start < data.length || level.length === 0; start += blockSize)
    level.push(sha256(data.subarray(start, start + blockSize)))
  const branch = hashBlockSize / SHA256_BYTES

  while (level.length > 1) {
    const next: Buffer[] = []

    for (let i = 0; i < level.length; i += branch)
      next.push(sha256(Buffer.concat(level.slice(i, i + branch))))
    level = next
  }

  return level[0].toString('base64url')
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Malformed verified_contents.json')

  return value as Record<string, unknown>
}

/**
 * The signed hashes in `verified_contents.json`. Throws unless the Web Store
 * signed them for the treehash format.
 */
export function readVerifiedContents(text: string, key: KeyObject = WEB_STORE_KEY): SignedContents {
  const entries: unknown = JSON.parse(text)

  if (!Array.isArray(entries)) throw new Error('Malformed verified_contents.json')
  const signed = entries
    .map((entry) => record(entry).signed_content)
    .find((content) => content !== undefined)
  const { payload, signatures } = record(signed)

  if (typeof payload !== 'string' || !Array.isArray(signatures))
    throw new Error('Malformed verified_contents.json')
  const webStore = signatures
    .map(record)
    .find((signature) => record(signature.header ?? {}).kid === 'webstore')

  if (
    !webStore ||
    typeof webStore.protected !== 'string' ||
    typeof webStore.signature !== 'string' ||
    !verify(
      'sha256',
      Buffer.from(`${webStore.protected}.${payload}`),
      key,
      Buffer.from(webStore.signature, 'base64url'),
    )
  )
    throw new Error('verified_contents.json is not signed by the Chrome Web Store')
  const body = record(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')))
  const hashes = Array.isArray(body.content_hashes) ? body.content_hashes.map(record) : []
  const tree = hashes.find((hash) => hash.format === 'treehash')
  const blockSize = tree?.block_size ?? 4096
  const hashBlockSize = tree?.hash_block_size ?? 4096

  if (
    typeof body.item_id !== 'string' ||
    typeof body.item_version !== 'string' ||
    !tree ||
    !Array.isArray(tree.files) ||
    typeof blockSize !== 'number' ||
    typeof hashBlockSize !== 'number' ||
    blockSize <= 0 ||
    hashBlockSize < SHA256_BYTES * 2 ||
    hashBlockSize % SHA256_BYTES !== 0
  )
    throw new Error('Malformed verified_contents.json')
  const roots = new Map<string, string>()

  for (const file of tree.files.map(record)) {
    if (typeof file.path !== 'string' || typeof file.root_hash !== 'string')
      throw new Error('Malformed verified_contents.json')
    roots.set(file.path, file.root_hash)
  }

  return { id: body.item_id, version: body.item_version, blockSize, hashBlockSize, roots }
}

/**
 * Throws unless `files` are exactly the signed files, each with its signed
 * hash. Paths ending in `/` (folders) and the `_metadata/` folder are skipped.
 */
export function checkFiles(signed: SignedContents, files: Record<string, Uint8Array>): void {
  const seen = new Set<string>()

  for (const [path, data] of Object.entries(files)) {
    if (path.endsWith('/') || path.startsWith('_metadata/')) continue
    const root = signed.roots.get(path)

    if (!root) throw new Error(`${path} is not one of the extension's signed files`)
    if (treeHashRoot(data, signed.blockSize, signed.hashBlockSize) !== root)
      throw new Error(`${path} differs from the Chrome Web Store's copy`)
    seen.add(path)
  }
  for (const path of signed.roots.keys()) if (!seen.has(path)) throw new Error(`${path} is missing`)
}
