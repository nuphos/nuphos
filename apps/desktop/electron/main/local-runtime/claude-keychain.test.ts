import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mock, test } from 'node:test'

const services: string[] = []

mock.module('node:child_process', {
  namedExports: {
    execFile: (
      file: string,
      args: string[],
      _options: unknown,
      callback: (error: null, stdout: string, stderr: string) => void,
    ) => {
      assert.equal(file, '/usr/bin/security')
      services.push(args[args.indexOf('-s') + 1] ?? '')
      callback(null, JSON.stringify({ claudeAiOauth: { accessToken: 'test-only' } }), '')
    },
  },
})
const { readAgentUsage } = await import('./agent-cli.ts')

test(
  'usage reads the same default or custom Keychain entry as Claude',
  {
    skip: process.platform !== 'darwin',
  },
  async (t) => {
    t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
      assert.equal((init.headers as Record<string, string>).authorization, 'Bearer test-only')

      return Response.json({ seven_day: { utilization: 12 } })
    })
    for (const storage of ['', '/custom/claude']) {
      assert.deepEqual(
        await readAgentUsage('claude-code', {
          CLAUDE_CONFIG_DIR: '/isolated/nuphos',
          CLAUDE_SECURESTORAGE_CONFIG_DIR: storage,
        }),
        { seven_day: { utilization: 12 } },
      )
    }
    const suffix = createHash('sha256').update('/custom/claude').digest('hex').slice(0, 8)

    assert.deepEqual(services, ['Claude Code-credentials', `Claude Code-credentials-${suffix}`])
  },
)
