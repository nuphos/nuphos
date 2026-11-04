import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import test from 'node:test'

import { zipSync } from 'fflate'

import { extensionIdOf, readCrx } from './crx.ts'
import { checkFiles, readVerifiedContents, treeHashRoot } from './verified-contents.ts'

const webStore = generateKeyPairSync('rsa', { modulusLength: 2048 })
const publisher = generateKeyPairSync('rsa', { modulusLength: 2048 })
const publisherKey = publisher.publicKey.export({ type: 'spki', format: 'der' })
const id = extensionIdOf(publisherKey)

const bytes = (text: string) => new TextEncoder().encode(text)

/** verified_contents.json as the Web Store writes it, signed with `key`. */
function verifiedContents(
  files: Record<string, Uint8Array>,
  { itemId = id, key = webStore.privateKey } = {},
) {
  const payload = Buffer.from(
    JSON.stringify({
      item_id: itemId,
      item_version: '1.0',
      protocol_version: 1,
      content_hashes: [
        {
          format: 'treehash',
          digest: 'sha256',
          block_size: 4096,
          hash_block_size: 4096,
          files: Object.entries(files).map(([path, data]) => ({
            path,
            root_hash: treeHashRoot(data, 4096, 4096),
          })),
        },
      ],
    }),
  ).toString('base64url')
  const protectedHeader = Buffer.from('{"alg":"RS256"}').toString('base64url')
  const signature = sign('sha256', Buffer.from(`${protectedHeader}.${payload}`), key)

  return JSON.stringify([
    {
      description: 'treehash per file',
      signed_content: {
        payload,
        signatures: [
          {
            header: { kid: 'webstore' },
            protected: protectedHeader,
            signature: signature.toString('base64url'),
          },
        ],
      },
    },
  ])
}

const files = {
  'manifest.json': bytes('{"name":"Test","version":"1.0","manifest_version":3}'),
  'background.js': bytes('console.log(1)'),
  'big.bin': new Uint8Array(4096 * 130).fill(7),
}

test('tree hash: one block is its SHA-256, an empty file hashes the empty block', () => {
  const data = bytes('hello')

  assert.equal(
    treeHashRoot(data, 4096, 4096),
    createHash('sha256').update(data).digest('base64url'),
  )
  assert.equal(treeHashRoot(new Uint8Array(), 4096, 4096), createHash('sha256').digest('base64url'))
})

test('signed files pass, and any change, extra file or missing file fails', () => {
  const signed = readVerifiedContents(verifiedContents(files), webStore.publicKey)

  assert.equal(signed.id, id)
  checkFiles(signed, { ...files, 'folder/': new Uint8Array(), '_metadata/x': new Uint8Array() })
  assert.throws(
    () => checkFiles(signed, { ...files, 'background.js': bytes('console.log(2)') }),
    /differs/,
  )
  assert.throws(() => checkFiles(signed, { ...files, 'evil.js': bytes('') }), /not one of/)
  const { 'background.js': _dropped, ...rest } = files

  assert.throws(() => checkFiles(signed, rest), /missing/)
})

test('hashes signed by any key but the Web Store are refused', () => {
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 })

  assert.throws(
    () =>
      readVerifiedContents(verifiedContents(files, { key: other.privateKey }), webStore.publicKey),
    /not signed by the Chrome Web Store/,
  )
})

/** A CRX3 whose header holds one RSA proof with `key`. */
function crx(key: Buffer, zip: Uint8Array) {
  const lengthDelimited = (number: number, data: Buffer) => {
    const length: number[] = []
    let n = data.length

    while (n >= 0x80) {
      length.push((n & 0x7f) | 0x80)
      n >>= 7
    }
    length.push(n)

    return Buffer.concat([Buffer.from([(number << 3) | 2, ...length]), data])
  }
  const proof = lengthDelimited(1, key)
  const header = lengthDelimited(2, proof)
  const prefix = Buffer.alloc(12)

  prefix.write('Cr24', 0, 'latin1')
  prefix.writeUInt32LE(3, 4)
  prefix.writeUInt32LE(header.length, 8)

  return Buffer.concat([prefix, header, Buffer.from(zip)])
}

test('a CRX gives its files and the publisher key with the requested ID', () => {
  const read = readCrx(crx(publisherKey, zipSync(files)), id)

  assert.equal(read.key, publisherKey.toString('base64'))
  assert.deepEqual(Object.keys(read.files).sort(), Object.keys(files).sort())
  assert.throws(() => readCrx(crx(publisherKey, zipSync(files)), 'a'.repeat(32)), /not signed by/)
  assert.throws(() => readCrx(Buffer.from('PK\u0003\u0004'), id), /Not a CRX3/)
})
