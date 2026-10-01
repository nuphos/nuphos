// Buffering a whole response and then measuring it means any sender who can
// attach a large file has already allocated it on the worker handling their
// webhook. The cap has to bite during the read.
import { describe, expect, test } from 'bun:test'

import { readBoundedBody } from './inbound-files'

function streamed(chunks: Uint8Array[], headers: Record<string, string> = {}): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    }),
    { headers },
  )
}

describe('readBoundedBody', () => {
  test('returns the body when it fits', async () => {
    const bytes = await readBoundedBody(streamed([new Uint8Array([1, 2, 3])]), 10)

    expect(bytes).toEqual(new Uint8Array([1, 2, 3]))
  })

  test('joins chunks in order', async () => {
    const bytes = await readBoundedBody(
      streamed([new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5])]),
      10,
    )

    expect(bytes).toEqual(new Uint8Array([1, 2, 3, 4, 5]))
  })

  test('refuses a declared Content-Length over the cap, whatever the body says', async () => {
    // The body here would have fitted; the declaration alone is enough to
    // refuse, so an oversized file is rejected before any of it is held.
    const response = streamed([new Uint8Array(4)], { 'content-length': '999' })

    expect(await readBoundedBody(response, 10)).toBeNull()
  })

  test('stops mid-stream once the cap is passed, rather than after', async () => {
    // Each chunk is under the cap; only their sum crosses it, so a check that
    // only ran at the end would have held all of them first.
    const bytes = await readBoundedBody(streamed([new Uint8Array(6), new Uint8Array(6)]), 10)

    expect(bytes).toBeNull()
  })

  test('an empty body is not a file', async () => {
    expect(await readBoundedBody(streamed([]), 10)).toBeNull()
  })
})
