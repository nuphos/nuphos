import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PreviewTooLargeError, readCappedText } from './read-capped.ts'

function streamed(parts: string[], headers: Record<string, string> = {}): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part))
      controller.close()
    },
  })

  return new Response(body, { headers })
}

test('reads a streamed body as UTF-8 text', async () => {
  assert.equal(await readCappedText(streamed(['<h1>報', '告</h1>']), 1024), '<h1>報告</h1>')
})

test('refuses a body whose declared length is over the cap', async () => {
  await assert.rejects(
    readCappedText(streamed(['x'], { 'content-length': '2048' }), 1024),
    PreviewTooLargeError,
  )
})

test('refuses a body that streams past the cap without declaring it', async () => {
  await assert.rejects(readCappedText(streamed(['abcd', 'efgh']), 6), PreviewTooLargeError)
})

test('an empty body is empty text', async () => {
  assert.equal(await readCappedText(new Response(null), 10), '')
})
