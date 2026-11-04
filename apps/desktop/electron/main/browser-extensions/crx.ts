// A Chrome Web Store CRX3: a protobuf header, then a zip. Only the publisher key
// is read from the header. The files are trusted through the Web Store's signed
// hashes (verified-contents.ts), not through the CRX signature.
import { createHash } from 'node:crypto'

import { unzipSync } from 'fflate'

/** The most an extension may unpack to; a bigger archive loses files and fails its check. */
export const MAX_UNPACKED_BYTES = 512 * 1024 * 1024

/** The extension ID Chrome derives from a public key: SHA-256, first 16 bytes, hex mapped to a-p. */
export function extensionIdOf(publicKey: Uint8Array): string {
  const hex = createHash('sha256').update(publicKey).digest('hex').slice(0, 32)

  return hex.replace(/[\da-f]/g, (digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)))
}

/** Length-delimited fields of one protobuf message, by field number. Other wire types are skipped. */
function fields(bytes: Uint8Array): [number, Uint8Array][] {
  const out: [number, Uint8Array][] = []
  let pos = 0
  const varint = () => {
    let value = 0
    let shift = 0

    for (;;) {
      if (pos >= bytes.length) throw new Error('Truncated CRX header')
      const byte = bytes[pos++]

      value += (byte & 0x7f) * 2 ** shift
      if (byte < 0x80) return value
      shift += 7
    }
  }

  while (pos < bytes.length) {
    const tag = varint()
    const type = tag % 8

    if (type === 0) varint()
    else if (type === 1) pos += 8
    else if (type === 5) pos += 4
    else if (type === 2) {
      const length = varint()

      if (pos + length > bytes.length) throw new Error('Truncated CRX header')
      out.push([Math.floor(tag / 8), bytes.subarray(pos, pos + length)])
      pos += length
    } else throw new Error('Unsupported CRX header field')
  }

  return out
}

/**
 * The files of a CRX3 and the publisher key whose ID is `extensionId`, as the
 * base64 `key` Electron needs to give the extension its Web Store ID.
 */
export function readCrx(
  crx: Uint8Array,
  extensionId: string,
): { key: string; files: Record<string, Uint8Array> } {
  const view = Buffer.from(crx.buffer, crx.byteOffset, crx.byteLength)

  if (view.length < 12 || view.toString('latin1', 0, 4) !== 'Cr24' || view.readUInt32LE(4) !== 3)
    throw new Error('Not a CRX3 file')
  const headerEnd = 12 + view.readUInt32LE(8)

  if (headerEnd > view.length) throw new Error('Truncated CRX header')
  // CrxFileHeader: 2 = sha256_with_rsa, 3 = sha256_with_ecdsa; AsymmetricKeyProof: 1 = public_key.
  const publicKey = fields(view.subarray(12, headerEnd))
    .filter(([field]) => field === 2 || field === 3)
    .flatMap(([, proof]) => fields(proof).filter(([field]) => field === 1))
    .map(([, key]) => key)
    .find((key) => extensionIdOf(key) === extensionId)

  if (!publicKey) throw new Error(`The CRX is not signed by ${extensionId}`)
  let unpacked = 0

  return {
    key: Buffer.from(publicKey).toString('base64'),
    files: unzipSync(view.subarray(headerEnd), {
      filter: (file) => {
        unpacked += file.originalSize

        return unpacked <= MAX_UNPACKED_BYTES
      },
    }),
  }
}
