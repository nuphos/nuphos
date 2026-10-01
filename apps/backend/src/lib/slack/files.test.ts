import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { usePosthog } from '@/lib/test/doubles/posthog'
import { useSlackApi } from '@/lib/test/doubles/slack-api'

// Slack API transport mock: records calls and simulates the failures the
// share flow degrades on (missing files:write scope, upload rejections).
const apiCalls: Record<string, unknown>[] = []
let failGetUploadUrlWith: string | null = null
let failCompleteWith: string | null = null

// files.ts → errors.ts → posthog.ts would otherwise drag in config (which
// demands real env vars at import time).
usePosthog({
  captureException: () => {},
})

// bun's mock.module registry is process-wide for a `bun test` run, so this
// mock must keep exporting EVERYTHING other files import from api.ts —
// spreading the real module makes that hold no matter what api.ts grows
// (a hand-kept export list broke CI when agent-outbound gained openSlackDm).
useSlackApi({
  slackApiGet: async (_token: string, method: string, params: Record<string, unknown>) => {
    apiCalls.push({ method, ...params })
    if (method === 'files.getUploadURLExternal') {
      if (failGetUploadUrlWith) throw new Error(failGetUploadUrlWith)

      return { ok: true, upload_url: 'https://uploads.slack.test/abc', file_id: 'F123' }
    }

    return { ok: true }
  },
  slackApi: async (_token: string, method: string, body: Record<string, unknown>) => {
    apiCalls.push({ method, ...body })
    if (method === 'files.completeUploadExternal' && failCompleteWith) {
      throw new Error(failCompleteWith)
    }

    return { ok: true }
  },
  postSlackMessage: async (args: Record<string, unknown>) => {
    apiCalls.push({ method: 'chat.postMessage', ...args })

    return { ok: true }
  },
})

// fetch handles both the presigned S3 GET and the Slack upload-URL POST.
const fetchCalls: { url: string; method: string; bodyLength?: number }[] = []
let failTransferDownload = false
const realFetch = globalThis.fetch

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input)
  const method = init?.method ?? 'GET'
  const body = init?.body as Uint8Array | undefined

  fetchCalls.push({ url, method, bodyLength: body?.byteLength })
  if (method === 'GET') {
    if (failTransferDownload) return new Response('nope', { status: 403 })

    return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 })
  }

  return new Response('OK', { status: 200 })
}) as typeof fetch
afterAll(() => {
  globalThis.fetch = realFetch
})

const { shareTransferGroupsToSlackThread } = await import('@/lib/slack/files')

function group(files: Record<string, unknown>[]): never {
  return {
    groupId: 'g1',
    direction: 'download',
    status: 'ready',
    label: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-02T00:00:00.000Z',
    files,
  } as never
}

const readyFile = (name: string, extra: Record<string, unknown> = {}) => ({
  id: 'i1',
  fileName: name,
  relPath: name,
  size: 4,
  contentType: 'text/plain',
  status: 'ready',
  downloadUrl: `https://s3.test/${name}`,
  ...extra,
})

const shareArgs = { token: 'xoxb-test', channel: 'C1', threadTs: '111.222' }

beforeEach(() => {
  apiCalls.length = 0
  fetchCalls.length = 0
  failGetUploadUrlWith = null
  failCompleteWith = null
  failTransferDownload = false
})

describe('shareTransferGroupsToSlackThread', () => {
  test('uploads every ready file into the thread via the external flow', async () => {
    await shareTransferGroupsToSlackThread({
      ...shareArgs,
      groups: [group([readyFile('report.txt'), readyFile('data.csv')])],
    })
    const methods = apiCalls.map((c) => c.method)

    expect(methods).toEqual([
      'files.getUploadURLExternal',
      'files.completeUploadExternal',
      'files.getUploadURLExternal',
      'files.completeUploadExternal',
    ])
    expect(apiCalls[0]).toMatchObject({ filename: 'report.txt', length: 4 })
    expect(apiCalls[1]).toMatchObject({
      channel_id: 'C1',
      thread_ts: '111.222',
      files: [{ id: 'F123', title: 'report.txt' }],
    })
    // Bytes went to the granted upload URL.
    expect(fetchCalls.filter((c) => c.method === 'POST')).toHaveLength(2)
    expect(fetchCalls.find((c) => c.method === 'POST')?.bodyLength).toBe(4)
  })

  test('skips files that are not ready or have no download URL', async () => {
    await shareTransferGroupsToSlackThread({
      ...shareArgs,
      groups: [
        group([
          readyFile('pending.txt', { status: 'pending', downloadUrl: undefined }),
          readyFile('failed.txt', { status: 'failed', downloadUrl: undefined }),
        ]),
      ],
    })
    expect(apiCalls).toHaveLength(0)
    expect(fetchCalls).toHaveLength(0)
  })

  test('missing files:write degrades every file to one fallback message', async () => {
    failGetUploadUrlWith = 'missing_scope'
    await shareTransferGroupsToSlackThread({
      ...shareArgs,
      groups: [group([readyFile('a.txt'), readyFile('b.txt')])],
    })
    // One failed attempt, then no more upload tries.
    expect(apiCalls.filter((c) => c.method === 'files.getUploadURLExternal')).toHaveLength(1)
    const fallback = apiCalls.find((c) => c.method === 'chat.postMessage')

    expect(fallback).toBeDefined()
    expect(String(fallback!.text)).toContain('`a.txt`')
    expect(String(fallback!.text)).toContain('`b.txt`')
    expect(String(fallback!.text)).toContain('re-installing')
    expect(fallback).toMatchObject({ channel: 'C1', threadTs: '111.222' })
  })

  test('an oversized file is not fetched and lands in the fallback note', async () => {
    await shareTransferGroupsToSlackThread({
      ...shareArgs,
      groups: [group([readyFile('huge.bin', { size: 500 * 1024 * 1024 }), readyFile('small.txt')])],
    })
    // huge.bin skipped without a download; small.txt attached normally.
    expect(fetchCalls.filter((c) => c.method === 'GET')).toHaveLength(1)
    expect(apiCalls.filter((c) => c.method === 'files.completeUploadExternal')).toHaveLength(1)
    const fallback = apiCalls.find((c) => c.method === 'chat.postMessage')

    expect(String(fallback!.text)).toContain('`huge.bin` (too large)')
    expect(String(fallback!.text)).not.toContain('small.txt')
    expect(String(fallback!.text)).not.toContain('re-installing')
  })

  test('one failed attachment does not drop the rest', async () => {
    failTransferDownload = true
    await shareTransferGroupsToSlackThread({
      ...shareArgs,
      groups: [group([readyFile('a.txt')])],
    })
    const fallback = apiCalls.find((c) => c.method === 'chat.postMessage')

    expect(String(fallback!.text)).toContain('`a.txt`')
  })
})
