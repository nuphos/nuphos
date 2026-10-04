import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useRuntimeCatalog } from '@/lib/test/doubles/runtime-catalog'
import { useRuntimeRegistry } from '@/lib/test/doubles/runtime-registry'

import { controlRegistry } from './agent-chat-registry'
import { readRuntimeFile, parseRuntimeFile } from './runtime-file'

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
        sessionId: 's',
        path: 'report.md',
        workspace: '/workspace',
        action: 'read',
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
