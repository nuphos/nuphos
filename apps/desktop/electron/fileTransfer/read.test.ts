import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readBoundedFile } from './read.ts'

import type { ResolveGroup } from './read.ts'
import type { ResolvedFile, TransferGroup } from './types.ts'

const args = { teamId: 'team', groupId: 'group', fileId: 'f', maxBytes: 4 }

function file(over: Partial<ResolvedFile> = {}): ResolvedFile {
  return {
    id: 'f',
    fileName: 'report.pdf',
    relPath: 'report.pdf',
    size: null,
    contentType: 'application/pdf',
    status: 'ready',
    downloadUrl: 'https://store/report.pdf',
    ...over,
  }
}

function resolver(files: ResolvedFile[]): ResolveGroup {
  return async (): Promise<TransferGroup> => ({
    groupId: 'group',
    direction: 'download',
    status: 'ready',
    label: null,
    files,
  })
}

// A body delivered chunk by chunk, so the test can see how much was read.
function streamOf(chunks: readonly Uint8Array[]) {
  let pulled = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled === chunks.length) {
        controller.close()

        return
      }
      controller.enqueue(chunks[pulled])
      pulled += 1
    },
  })

  return { stream, pulled: () => pulled }
}

test('reads a file whose record has no size', async (t) => {
  // The record supplies the size for the renderer's first check, but it may be
  // null; the main process reads by id and lets the bytes decide.
  t.mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array([1, 2, 3])))

  const bytes = await readBoundedFile(args, resolver([file({ size: null })]))

  assert.deepEqual(bytes, new Uint8Array([1, 2, 3]))
})

test('stops reading as soon as the body passes the cap and answers null', async (t) => {
  const chunks = Array.from({ length: 8 }, () => new Uint8Array(3))
  const body = streamOf(chunks)

  t.mock.method(globalThis, 'fetch', async () => new Response(body.stream))

  const bytes = await readBoundedFile({ ...args, maxBytes: 4 }, resolver([file({ size: null })]))

  assert.equal(bytes, null)
  // Not the whole object: the read stops at the first chunk that crosses the cap.
  assert.ok(body.pulled() < chunks.length)
})

test('a file exactly at the cap is still read', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array([1, 2, 3, 4])))

  const bytes = await readBoundedFile(args, resolver([file({ size: 4 })]))

  assert.deepEqual(bytes, new Uint8Array([1, 2, 3, 4]))
})

// A group the store has already dropped: resolving it throws.
const expired: ResolveGroup = async () => {
  throw new Error('HTTP 410')
}

test('an empty body, an expired group, a missing file or no link all answer null', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array(0)))

  assert.equal(await readBoundedFile(args, resolver([file()])), null)

  t.mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array([1])))

  assert.equal(await readBoundedFile(args, expired), null)
  assert.equal(await readBoundedFile({ ...args, fileId: 'gone' }, resolver([file()])), null)
  assert.equal(await readBoundedFile(args, resolver([file({ downloadUrl: undefined })])), null)
})
