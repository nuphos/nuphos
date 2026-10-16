// A fork or local-session import creates the conversation from its whole
// history, so there is no stored prefix to window against. A long history
// still has to stay under the ingress body limit, so it goes in chunks.

/** Request body budget for one chunk of an import, well under the ingress limit. */
export const IMPORT_CHUNK_BYTES = 512 * 1024

/**
 * An imported history split into runs of whole messages, each about `maxBytes`
 * of JSON at most, so no single request reaches the ingress limit. A message
 * larger than that on its own still goes in a chunk by itself. Always at least
 * one chunk, since the first one creates the conversation.
 */
export function importChunks<M>(messages: M[], maxBytes = IMPORT_CHUNK_BYTES): M[][] {
  const chunks: M[][] = [[]]
  let size = 0

  for (const message of messages) {
    const bytes = Buffer.byteLength(JSON.stringify(message))
    const current = chunks[chunks.length - 1]!

    if (current.length > 0 && size + bytes > maxBytes) {
      chunks.push([message])
      size = bytes
    } else {
      current.push(message)
      size += bytes
    }
  }

  return chunks
}

/**
 * Sends an import chunk by chunk, each at the index where the stored history
 * ends. A retry after a partial import is safe: the server skips the chunks it
 * already holds and appends the rest.
 */
export async function importInChunks<M>(
  messages: M[],
  put: (chunk: M[], baseIndex: number | undefined) => Promise<{ skipped?: string }>,
  maxBytes = IMPORT_CHUNK_BYTES,
): Promise<void> {
  let stored = 0
  let created = false

  for (const chunk of importChunks(messages, maxBytes)) {
    const result = await put(chunk, stored > 0 ? stored : undefined)

    if (stored === 0) created = !result.skipped
    // This call created the conversation, so a refused chunk means a server
    // that does not take import chunks: it kept only the first one.
    else if (created && result.skipped) {
      throw new Error('The chat history could not be copied in full')
    }
    stored += chunk.length
  }
}
