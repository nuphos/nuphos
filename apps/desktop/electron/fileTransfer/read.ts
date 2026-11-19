import type { TransferGroup } from './types'

export type FileBytesArgs = {
  teamId: string
  sessionId?: string
  groupId: string
  fileId: string
  maxBytes: number
}

// Injected so the read can be exercised without Electron (see read.test.ts).
export type ResolveGroup = (
  teamId: string,
  sessionId: string | undefined,
  groupId: string,
) => Promise<TransferGroup>

/**
 * Read one file's bytes for an in-app preview, bounded by `maxBytes`.
 *
 * The body is streamed and the read stops the moment the count passes the cap,
 * so an oversized object is never pulled into memory. The record's own size is
 * not consulted — it may be null — the bytes decide. Null covers everything the
 * caller falls back to Download for: over the cap, expired, missing or empty.
 */
export async function readBoundedFile(
  args: FileBytesArgs,
  resolve: ResolveGroup,
): Promise<Uint8Array | null> {
  const group = await resolve(args.teamId, args.sessionId, args.groupId).catch(() => null)

  if (!group) return null
  const file = group.files.find((f) => f.id === args.fileId)

  if (!file?.downloadUrl) return null
  const res = await fetch(file.downloadUrl).catch(() => null)

  if (!res?.ok || !res.body) return null
  // undici types the body as `ReadableStream<any>`; a fetch body is bytes.
  const reader: ReadableStreamDefaultReader<Uint8Array> = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()

      if (done) break
      total += value.byteLength
      if (total > args.maxBytes) {
        try {
          // Stop the transfer too; a cancel that races the close is fine to drop.
          await reader.cancel()
        } catch {
          // The read is over either way.
        }

        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  // An empty object is nothing to preview.
  if (total === 0) return null
  const bytes = new Uint8Array(total)
  let offset = 0

  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return bytes
}
