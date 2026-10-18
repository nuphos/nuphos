import assert from 'node:assert/strict'
import { test } from 'node:test'

import { IMPORT_CHUNK_BYTES, importChunks, importInChunks } from './transcript-import.ts'

const u = (id: string) => ({ id, role: 'user' as const })
const a = (id: string) => ({ id, role: 'assistant' as const })

test('an import splits into whole messages under the byte budget, in order', () => {
  const big = (id: string) => ({ id, output: 'x'.repeat(100) })
  const messages = Array.from({ length: 7 }, (_, i) => big(`m${String(i)}`))
  const chunks = importChunks(messages, 400)

  assert.deepEqual(
    chunks.map((chunk) => chunk.length),
    [3, 3, 1],
  )
  assert.deepEqual(chunks.flat(), messages)
})

test('an oversized message goes alone, and an empty import is one empty chunk', () => {
  const huge = { id: 'huge', output: 'x'.repeat(1000) }

  assert.deepEqual(importChunks([u('u1'), huge, a('a1')], 200), [[u('u1')], [huge], [a('a1')]])
  assert.deepEqual(importChunks([]), [[]])
})

// A long chat with large tool output: 40 messages of about 100 KB, 4 MB in all.
const history = Array.from({ length: 40 }, (_, index) => ({
  id: `m${String(index)}`,
  role: index % 2 ? 'assistant' : 'user',
  parts: [{ type: 'text', text: 'x'.repeat(100_000) }],
}))

type Put = { messages: typeof history; baseIndex: number | undefined }

function recorder(answer: (put: Put) => { skipped?: string; messageCount?: number } = () => ({})) {
  const puts: Put[] = []

  return {
    puts,
    put: (messages: typeof history, baseIndex: number | undefined) => {
      const put = { messages, baseIndex }

      puts.push(put)

      return Promise.resolve(answer(put))
    },
  }
}

test('a long import goes in requests that each stay under the budget', async () => {
  const { puts, put } = recorder()

  await importInChunks(history, put)
  assert.ok(puts.length > 1)
  let stored = 0

  for (const chunk of puts) {
    assert.ok(Buffer.byteLength(JSON.stringify(chunk.messages)) <= IMPORT_CHUNK_BYTES)
    // Each chunk starts where the stored history ends.
    assert.equal(chunk.baseIndex, stored > 0 ? stored : undefined)
    stored += chunk.messages.length
  }
  assert.deepEqual(
    puts.flatMap((chunk) => chunk.messages),
    history,
  )
})

test('a retry after a partial import skips the stored chunk and sends the rest', async () => {
  // The first attempt stored the first chunk; the server says so when it skips it.
  let held = importChunks(history)[0]!.length
  const { puts, put } = recorder((chunk) => {
    if (!chunk.baseIndex && held > 0) return { skipped: 'server_authoritative', messageCount: held }
    held += chunk.messages.length

    return {}
  })

  await importInChunks(history, put)
  assert.deepEqual(
    puts.slice(1).flatMap((chunk) => chunk.messages),
    history.slice(puts[0]!.messages.length),
  )
})

test('a retry of an import that fully landed, response lost, succeeds', async () => {
  // Every chunk is stored. The first one comes back as a stale skip with the
  // stored count; the rest rewrite what the server already holds.
  const { puts, put } = recorder((chunk) =>
    chunk.baseIndex ? {} : { skipped: 'stale', messageCount: history.length },
  )

  await importInChunks(history, put)
  assert.ok(puts.length > 1)
  assert.deepEqual(
    puts.flatMap((chunk) => chunk.messages),
    history,
  )
})

test('a retry the server refuses to append to is reported, not taken for success', async () => {
  // An older server skips every chunk of an existing conversation without a count.
  const { put } = recorder(() => ({ skipped: 'server_authoritative' }))

  await assert.rejects(importInChunks(history, put), /could not be copied in full/)
})

test('a server that keeps only the first chunk is reported, not left half copied', async () => {
  const { put } = recorder((chunk) => (chunk.baseIndex ? { skipped: 'server_authoritative' } : {}))

  await assert.rejects(importInChunks(history, put), /could not be copied in full/)
})

test('a skipped single-chunk import is a retry of one that landed whole', async () => {
  const { put } = recorder(() => ({ skipped: 'server_authoritative' }))

  await assert.doesNotReject(importInChunks(history.slice(0, 1), put))
})
