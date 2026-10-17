import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import * as transfers from '@/lib/file-transfer/service'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useRuntimeCatalog } from '@/lib/test/doubles/runtime-catalog'
import { useRuntimeRegistry } from '@/lib/test/doubles/runtime-registry'

import { controlRegistry } from './agent-chat-registry'
import { readRuntimeFile, parseRuntimeFile, shareRuntimeFile } from './runtime-file'

let conversation: Record<string, unknown> | null
let calls = 0
const endpoint = { runtimeId: 'r', url: 'wss://agent.test/acp', authKey: 'fixture' }

useAgentDb({ getReadableConversation: async () => conversation })
useRuntimeCatalog({
  requireRuntimeInstance: async () => ({
    id: 'r',
    provider: 'codex',
    status: 'active',
    kind: 'external',
  }),
  developmentRuntimeEndpoint: () => {},
})
useRuntimeRegistry({ resolveTeamRuntimeEndpoints: async () => [endpoint] })
let restore = () => {}

afterEach(() => restore())

beforeEach(() => {
  const acquire = spyOn(controlRegistry, 'acquire').mockResolvedValue({
    runJob: async (request: { stdin: string }) => {
      calls++
      expect(JSON.parse(request.stdin).params).toEqual({
        path: 'report.md',
        workspace: '/workspace',
        action: 'read',
        sessionId: 's',
      })

      return { stdout: JSON.stringify({ name: 'report.md', data: 'aGk=', size: 2 }) }
    },
  } as unknown as Awaited<ReturnType<typeof controlRegistry.acquire>>)
  const jobs = spyOn(controlRegistry, 'runtimeJobs').mockReturnValue(['panel'])

  restore = () => {
    acquire.mockRestore()
    jobs.mockRestore()
  }
  calls = 0
  conversation = { sessionId: 's', userId: 'owner', teamId: 'team', runtimeId: 'r' }
})

test('reads the requested source through its panel job', async () => {
  expect(await readRuntimeFile('team', 'owner', 'r', 's', 'report.md')).toEqual({
    name: 'report.md',
    data: 'aGk=',
    size: 2,
  })
  expect(calls).toBe(1)
})

test('rejects another viewer, team and unrelated runtime before reading', async () => {
  for (const value of [
    null,
    { userId: 'someone', teamId: 'team', runtimeId: 'r' },
    { userId: 'owner', teamId: 'other', runtimeId: 'r' },
    { userId: 'owner', teamId: 'team', runtimeId: 'other' },
  ]) {
    conversation = value
    await expect(readRuntimeFile('team', 'owner', 'r', 's', 'report.md')).rejects.toThrow()
  }
  expect(calls).toBe(0)
})

test('a moved conversation reads the original runtime without redirecting', async () => {
  conversation = {
    userId: 'owner',
    teamId: 'team',
    runtimeId: 'new',
    previousRuntimeUrls: [endpoint.url],
  }
  expect((await readRuntimeFile('team', 'owner', 'r', 's', 'report.md')).name).toBe('report.md')
})

test('maps file errors and rejects malformed runtime responses', () => {
  expect(() => parseRuntimeFile('{"error":"file_not_found"}')).toThrow('no longer exists')
  expect(() => parseRuntimeFile('{"error":"file_too_large"}')).toThrow('512 KiB')
  for (const value of ['garbage', 'null', '{}', '{"name":"x","size":99,"data":"aGk="}'])
    expect(() => parseRuntimeFile(value)).toThrow()
})

test('a large file is sized, uploaded to a new download transfer, then finalized', async () => {
  restore()
  const params: Record<string, unknown>[] = []
  const acquire = spyOn(controlRegistry, 'acquire').mockResolvedValue({
    runJob: async (request: { stdin: string; timeoutMs: number }) => {
      params.push({ ...JSON.parse(request.stdin).params, timeoutMs: request.timeoutMs })

      return { stdout: JSON.stringify({ name: 'clip.mp4', size: 46_000_000 }) }
    },
  } as unknown as Awaited<ReturnType<typeof controlRegistry.acquire>>)
  const jobs = spyOn(controlRegistry, 'runtimeJobs').mockReturnValue(['panel'])
  const create = spyOn(transfers, 'createTransfer').mockResolvedValue({
    groupId: 'g',
    direction: 'download',
    status: 'pending',
    expiresAt: '',
    files: [
      {
        id: 'f',
        fileName: 'clip.mp4',
        relPath: 'clip.mp4',
        uploadUrl: 'https://s3/put',
        expiresAt: '',
      },
    ],
  })
  const finalize = spyOn(transfers, 'finalizeTransfer').mockResolvedValue({
    status: 'ready',
  } as Awaited<ReturnType<typeof transfers.finalizeTransfer>>)

  restore = () => {
    for (const spy of [acquire, jobs, create, finalize]) spy.mockRestore()
  }
  conversation = {
    sessionId: 's',
    userId: 'owner',
    teamId: '0123456789abcdef01234567',
    runtimeId: 'r',
  }

  expect(
    await shareRuntimeFile('0123456789abcdef01234567', 'owner', 'r', 's', '/data/clip.mp4'),
  ).toEqual({ groupId: 'g', fileId: 'f', fileName: 'clip.mp4', size: 46_000_000 })
  expect(
    params.map(({ action, url, size, timeoutMs }) => ({ action, url, size, timeoutMs })),
  ).toEqual([
    { action: 'stat', url: undefined, size: undefined, timeoutMs: 10_000 },
    { action: 'upload', url: 'https://s3/put', size: 46_000_000, timeoutMs: 110_000 },
  ])
  expect(create.mock.calls[0]?.[1]).toBe('download')
  expect(create.mock.calls[0]?.[0].sessionId).toBe('s')
})
