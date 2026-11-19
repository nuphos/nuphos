import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

const RUNNER = fileURLToPath(new URL('./panel-runner.mjs', import.meta.url))
const TEAM_ID = '0000000000000000000000a1'
let server: ReturnType<typeof Bun.serve>
let authorizationHeaders: (string | null)[] = []

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      authorizationHeaders.push(request.headers.get('authorization'))
      // `/gone/<code>` answers as a route whose integration is not bound, with that code.
      const gone = /\/gone\/([a-z_]+)$/.exec(new URL(request.url).pathname)?.[1]

      if (gone)
        return Response.json({ error: { code: gone, message: 'No such binding' } }, { status: 404 })

      return Response.json({ value: 42 })
    },
  })
})

afterAll(() => server.stop(true))

async function runPanel(
  code: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const runDir = await mkdtemp(join(tmpdir(), 'panel-runner-'))

  try {
    await Promise.all([
      writeFile(join(runDir, 'params.json'), JSON.stringify({ teamId: TEAM_ID })),
      writeFile(join(runDir, 'script.mjs'), code),
    ])
    const process = Bun.spawn(['node', RUNNER, runDir], {
      env: {
        ...Bun.env,
        NUPHOS_BACKEND_URL: server.url.toString().replace(/\/$/, ''),
        NUPHOS_TOKEN: 'test-token',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ])

    return { exitCode, stdout, stderr }
  } finally {
    await rm(runDir, { recursive: true, force: true })
  }
}

describe('panel runner Nuphos client', () => {
  test('allows GET requests scoped to the dashboard team', async () => {
    authorizationHeaders = []
    const result = await runPanel(`
      const response = await nuphos.get('/teams/${TEAM_ID}/usage')
      emit({ kind: 'scalar', title: 'Cost', value: response.value, unit: 'usd' })
    `)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('__PANEL_OUTPUT__')
    expect(authorizationHeaders).toEqual(['Bearer test-token'])
  })

  test('rejects routes for another team before sending the token', async () => {
    authorizationHeaders = []
    const result = await runPanel(`
      await nuphos.get('/teams/0000000000000000000000b2/usage')
    `)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('may only call routes for this dashboard team')
    expect(authorizationHeaders).toHaveLength(0)
  })

  test('allows credential routes for the dashboard team', async () => {
    authorizationHeaders = []
    const result = await runPanel(`
      const response = await nuphos.get(
        '/teams/${TEAM_ID}/linode-accounts/account-123/credentials'
      )
      emit({ kind: 'scalar', title: 'Credential request', value: response.value, unit: 'count' })
    `)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('__PANEL_OUTPUT__')
    expect(authorizationHeaders).toEqual(['Bearer test-token'])
  })

  test('emits a structured diagnostic while redacting credentials', async () => {
    const result = await runPanel(`
      throw new Error(
        'request failed with Bearer test-token, token=test-token, apiKey=hardcoded-secret'
      )
    `)

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('__PANEL_ERROR__')
    expect(result.stdout).toContain('request failed')
    expect(result.stdout).not.toContain('test-token')
    expect(result.stdout).not.toContain('hardcoded-secret')
    expect(result.stdout).toContain('[REDACTED]')
  })
})

describe('panel runner not-connected answers', () => {
  const envelope = (stdout: string) =>
    JSON.parse(stdout.split('__PANEL_ERROR__')[1]?.split('\n')[0] ?? '{}') as {
      message: string
      notConnected?: string
    }

  for (const [code, name] of [
    ['grafana_instance_not_bound', 'Grafana instance'],
    ['github_installation_not_bound', 'GitHub installation'],
    ['uptime_kuma_instance_not_bound', 'Uptime Kuma instance'],
    ['account_not_bound', 'AWS account'],
  ] as const) {
    test(`names the integration of a ${code} answer`, async () => {
      const result = await runPanel(`await nuphos.get('/teams/${TEAM_ID}/gone/${code}')`)

      expect(result.exitCode).toBe(1)
      expect(envelope(result.stdout).notConnected).toBe(name)
      // The full answer stays in the diagnostic for the error log.
      expect(envelope(result.stdout).message).toContain(`404 {"error":{"code":"${code}"`)
    })
  }

  test('leaves any other failure unnamed', async () => {
    const result = await runPanel(`await nuphos.get('/teams/${TEAM_ID}/gone/not_found')`)

    expect(result.exitCode).toBe(1)
    expect(envelope(result.stdout).notConnected).toBeUndefined()
  })
})
