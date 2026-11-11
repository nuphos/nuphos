/** The most an in-app preview reads; bigger files are downloaded instead. */
export const PREVIEW_TEXT_MAX_BYTES = 5 * 1024 * 1024

export class PreviewTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`File is larger than ${String(Math.round(maxBytes / 1024 / 1024))} MB to preview`)
    this.name = 'PreviewTooLargeError'
  }
}

/**
 * A response body as UTF-8 text, refusing anything over `maxBytes` — by its
 * declared length up front, and again while it streams, since a server may not
 * send one (or send a wrong one).
 */
export async function readCappedText(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length'))

  if (Number.isFinite(declared) && declared > maxBytes) throw new PreviewTooLargeError(maxBytes)
  if (!res.body) return ''
  const reader: ReadableStreamDefaultReader<Uint8Array> = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  for (;;) {
    const { done, value } = await reader.read()

    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new PreviewTooLargeError(maxBytes)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0

  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return new TextDecoder('utf-8').decode(bytes)
}
