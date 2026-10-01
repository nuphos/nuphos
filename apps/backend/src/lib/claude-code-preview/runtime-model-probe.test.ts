import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'bun:test'

import { RUNTIME_MODEL_PROBE } from './runtime-model-probe'

async function probeFixture(
  result: unknown,
  provider = 'codex',
  model?: string,
  updated?: unknown,
) {
  const directory = await mkdtemp(join(tmpdir(), 'nuphos-model-probe-'))
  const methods = join(directory, 'methods.jsonl')
  const fixture = `#!/usr/bin/env node
const fs = require('node:fs');
if (process.env.OPENAB_ACP_AUTH_KEY || process.env.NUPHOS_RUNTIME_SKILLS_TOKEN) process.exit(10);
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  fs.appendFileSync(${JSON.stringify(methods)}, JSON.stringify(request) + '\\n');
  console.error('private-provider-diagnostic');
  const result = request.method === 'initialize' ? { protocolVersion: 1 } : request.method === 'session/set_config_option' ? ${JSON.stringify(updated) ?? 'null'} : ${JSON.stringify(result)};
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
});
`

  try {
    for (const command of ['codex-acp', 'claude-agent-acp'])
      await writeFile(join(directory, command), fixture, { mode: 0o755 })
    const child = Bun.spawn(
      [
        'node',
        '--input-type=module',
        '-e',
        RUNTIME_MODEL_PROBE.replaceAll("'/workspace'", JSON.stringify(directory)),
        provider,
        ...(model ? [model] : []),
      ],
      {
        env: {
          ...process.env,
          OPENAB_ACP_AUTH_KEY: 'fixture-transport',
          NUPHOS_RUNTIME_SKILLS_TOKEN: 'fixture-skills',
          PATH: `${directory}:${process.env.PATH}`,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    const requests = (await readFile(methods, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))

    return { code, stdout, stderr, requests }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('native model discovery initializes only, sends no prompt, and returns whitelisted metadata', async () => {
  const result = await probeFixture({
    configOptions: [
      {
        category: 'model',
        options: [
          {
            value: 'model-a',
            name: 'Model A',
            description: 'Available to this account',
            secret: 'private',
          },
          { value: 123, name: 'invalid' },
        ],
      },
    ],
    secret: 'private',
  })

  expect(result.code).toBe(0)
  expect(JSON.parse(result.stdout).models).toEqual([
    { id: 'model-a', name: 'Model A', description: 'Available to this account' },
  ])
  expect(result.stderr).toBe('')
  expect(result.requests.map((request) => request.method)).toEqual(['initialize', 'session/new'])
  expect(result.requests[1].params.mcpServers).toEqual([])
  expect(result.stdout).not.toContain('private')
})

test('Claude legacy-only models are not advertised when defaults cannot apply them', async () => {
  const result = await probeFixture(
    { models: { availableModels: [{ modelId: 'opus', name: 'Opus' }] } },
    'claude-code',
  )

  expect(result.code).not.toBe(0)
  expect(result.stdout).toBe('')
})

test('malformed catalogs fail without forwarding native output', async () => {
  const result = await probeFixture({ configOptions: 'private' })

  expect(result.code).not.toBe(0)
  expect(result.stdout).toBe('')
})

for (const provider of ['codex', 'claude-code']) {
  test(`${provider} reads effort and fast from the selected model acknowledgement without prompting`, async () => {
    const models = {
      id: 'model',
      category: 'model',
      currentValue: 'first',
      options: [
        { value: 'first', name: 'First' },
        { value: 'second', name: 'Second' },
      ],
    }
    const result = await probeFixture(
      { sessionId: 'probe-session', configOptions: [models] },
      provider,
      'second',
      {
        configOptions: [
          { ...models, currentValue: 'second' },
          { id: 'reasoning_effort', options: [{ value: 'ultra', name: 'Ultra' }] },
          { id: 'fast_mode', currentValue: 'off', options: [{ value: 'on' }, { value: 'off' }] },
        ],
      },
    )

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout).controls).toEqual({
      modelId: 'second',
      effort: [{ value: 'ultra', name: 'Ultra' }],
      fast: true,
      defaultFast: 'off',
    })
    expect(result.requests.map((request) => request.method)).toEqual([
      'initialize',
      'session/new',
      'session/set_config_option',
    ])
    expect(result.requests[2].params).toEqual({
      sessionId: 'probe-session',
      configId: 'model',
      value: 'second',
    })
  })
}

test('a rejected model acknowledgement does not advertise stale capabilities', async () => {
  const configOptions = [
    {
      id: 'model',
      currentValue: 'first',
      options: [
        { value: 'first', name: 'First' },
        { value: 'second', name: 'Second' },
      ],
    },
  ]
  const result = await probeFixture(
    { sessionId: 'probe-session', configOptions },
    'codex',
    'second',
    { configOptions },
  )

  expect(result.code).not.toBe(0)
  expect(result.stdout).toBe('')
})
