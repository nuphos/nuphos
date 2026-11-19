import { createReadStream } from 'node:fs'

import { MIGRATION_LIMITS } from './format'
import { invalidArchive } from './zip'

export async function* boundedJsonLines(
  chunks: AsyncIterable<Uint8Array>,
  ndjson: boolean,
): AsyncGenerator {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let tail = ''
  let tailBytes = 0

  for await (const chunk of chunks) {
    const text = decoder.decode(chunk, { stream: true })

    for (const piece of ndjson ? text.split(/(?<=\n)/u) : [text]) {
      tailBytes += Buffer.byteLength(piece)
      if (tailBytes > MIGRATION_LIMITS.recordBytes) invalidArchive('record size limit')
      tail += piece
      if (ndjson && tail.endsWith('\n')) {
        if (tail.trim()) yield JSON.parse(tail)
        else invalidArchive('empty NDJSON record')
        tail = ''
        tailBytes = 0
      }
    }
  }
  const final = decoder.decode()

  tailBytes += Buffer.byteLength(final)
  if (tailBytes > MIGRATION_LIMITS.recordBytes) invalidArchive('record size limit')
  tail += final
  if (tail.trim()) yield JSON.parse(tail)
  else if (!ndjson) invalidArchive('missing JSON record')
}

export async function* importedRows(path: string): AsyncGenerator<Record<string, unknown>> {
  yield* boundedJsonLines(
    createReadStream(path, { highWaterMark: 64 * 1024 }),
    true,
  ) as AsyncGenerator<Record<string, unknown>>
}
