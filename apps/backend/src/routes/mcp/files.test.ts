import '@/routes/agent'

import { beforeEach, expect, test } from 'bun:test'

import { TOOL_DEFINITIONS } from '@/lib/mcp/protocol'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useFileTransferService } from '@/lib/test/doubles/file-transfer-service'

let readable = true
let calls: unknown[] = []

useAgentDb({
  getReadableConversation: async () =>
    readable
      ? ({
          sessionId: 'task',
          teamId: '111111111111111111111111',
          userId: 'owner',
        } as never)
      : null,
})
useFileTransferService({
  listSessionDownloadsSince: async (args) => {
    calls.push(args)

    return [
      {
        groupId: 'group',
        files: [{ fileName: 'screenshot.png', downloadUrl: 'https://storage.example/file' }],
      },
    ] as never
  },
})
const run = async (args: Record<string, unknown> = { session_id: 'task' }) => {
  const { toolsForContext } = await import('./tools')
  const handler = toolsForContext({ userId: 'caller' } as never).nuphos_files

  expect(handler).toBeDefined()

  return handler(args)
}

beforeEach(() => {
  readable = true
  calls = []
})
test('advertises files published through the existing transfer store', () => {
  expect(TOOL_DEFINITIONS.find((tool) => tool.name === 'nuphos_files')?.description).toContain(
    'download',
  )
})
test('returns existing transfer download URLs for a readable Task', async () => {
  const result = await run()

  expect(result.isError).not.toBe(true)
  expect(result.structuredContent).toMatchObject({
    groups: [{ files: [{ downloadUrl: 'https://storage.example/file' }] }],
  })
  expect(calls).toHaveLength(1)
})
test('a private or missing Task cannot list files', async () => {
  readable = false
  expect((await run()).isError).toBe(true)
  expect(calls).toHaveLength(0)
})
test.each([
  { session_id: '' },
  { session_id: 'task', limit: 0 },
  { session_id: 'task', limit: 101 },
])('invalid arguments never reach the file service', async (args) => {
  expect((await run(args)).isError).toBe(true)
  expect(calls).toHaveLength(0)
})
