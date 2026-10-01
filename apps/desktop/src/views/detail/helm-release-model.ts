export type HelmRelease = {
  name?: string
  namespace?: string
  version?: number
  info?: {
    status?: string
    description?: string
    first_deployed?: string
    last_deployed?: string
  }
  chart?: {
    metadata?: {
      name?: string
      version?: string
      appVersion?: string
    }
  }
  config?: Record<string, unknown>
  manifest?: string
  hooks?: unknown[]
}

const MAX_HELM_COMPRESSED_BYTES = 8 * 1024 * 1024

export const MAX_HELM_DECOMPRESSED_BYTES = 16 * 1024 * 1024
const MAX_HELM_ENCODED_BYTES = Math.ceil((MAX_HELM_COMPRESSED_BYTES * 4) / 3) + 4

function decodeBase64(value: string, maxBytes: number, label: string): Uint8Array {
  if (value.length > Math.ceil((maxBytes * 4) / 3) + 4) {
    throw new Error(`${label} exceeds the supported size limit`)
  }
  const binary = atob(value)

  if (binary.length > maxBytes) throw new Error(`${label} exceeds the supported size limit`)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)

  return bytes
}

async function readBounded(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  for (;;) {
    const { done, value } = await reader.read()

    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error('Decompressed Helm release exceeds the supported size limit')
    }
    chunks.push(value)
  }

  const output = new Uint8Array(total)
  let offset = 0

  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }

  return output
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))

  return readBounded(stream, MAX_HELM_DECOMPRESSED_BYTES)
}

/** Decode Helm 3's base64(gzip(JSON)) storage payload. Secret YAML adds an outer base64 layer. */
export async function decodeHelmRelease(kind: string, stored: string): Promise<HelmRelease> {
  const encoded =
    kind === 'Secret'
      ? new TextDecoder()
          .decode(decodeBase64(stored, MAX_HELM_ENCODED_BYTES, 'Helm storage payload'))
          .trim()
      : stored.trim()
  const compressed = decodeBase64(encoded, MAX_HELM_COMPRESSED_BYTES, 'Helm release payload')
  const json = new TextDecoder().decode(await gunzip(compressed))
  const value: unknown = JSON.parse(json)

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Helm release payload is not an object')
  }

  return value
}
