import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

import { patchAdapter } from '../image/codex-acp/patch-adapter.mjs'

const source = process.argv[2]

if (!source)
  throw new Error('Usage: node test/codex-acp-smoke.mjs <unpatched codex-acp dist/index.js>')
const fromAdapter = createRequire(resolve(source))
const fromRuntime = createRequire(new URL('../image/codex-acp/package.json', import.meta.url))

assert.equal(
  fromAdapter.resolve('@openai/codex/bin/codex.js'),
  fromRuntime.resolve('@openai/codex/bin/codex.js'),
  'The adapter and interactive CLI must use the same pinned Codex installation',
)
const base = mkdtempSync(join(tmpdir(), 'nuphos-codex-acp-smoke-'))
const helper = readFileSync(
  new URL('../image/codex-acp/session-config.mjs', import.meta.url),
  'utf8',
)

writeFileSync(join(base, 'patched.mjs'), patchAdapter(readFileSync(source, 'utf8'), helper))
writeFileSync(`${base}/requests.jsonl`, '')
const child = spawn(process.execPath, [`${base}/patched.mjs`], {
  env: {
    PATH: process.env.PATH,
    HOME: base,
    GOMEMLIMIT: '6GiB',
    NODE_OPTIONS: '--max-old-space-size=6144',
    CODEX_PATH: fileURLToPath(new URL('./fixtures/codex-app-server.mjs', import.meta.url)),
    NUPHOS_SMOKE_RECORD: `${base}/requests.jsonl`,
    OPENAB_CREDENTIALS_DIR: base,
  },
  stdio: ['pipe', 'pipe', 'pipe'],
})
let next = 0
const pending = new Map()
let stderr = ''

child.stderr.on('data', (b) => {
  stderr += b
})
createInterface({ input: child.stdout }).on('line', (line) => {
  const msg = JSON.parse(line)

  if (pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
})
const rpc = async (method, params) => {
  const id = ++next
  const promise = new Promise((resolve) => pending.set(id, resolve))

  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  const r = await Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout ${method}: ${stderr}`)), 10000).unref(),
    ),
  ])

  assert.equal(r.error, undefined, JSON.stringify(r.error))

  return r.result
}

try {
  await rpc('initialize', {
    protocolVersion: 1,
    clientInfo: { name: 'nuphos-smoke', version: '1' },
    clientCapabilities: {},
  })
  const args = (actor) => ({
    cwd: '/workspace/conv-smoke',
    mcpServers: [
      {
        name: 'nuphos',
        type: 'http',
        url: 'http://fixture.invalid/mcp',
        headers: [{ name: 'Authorization', value: `Bearer ${actor}` }],
      },
    ],
    _meta: {
      'ai.nuphos/codex': {
        developerInstructions: `context ${actor}`,
        env: { NUPHOS_TOKEN: actor, NUPHOS_SESSION_ID: 'conversation-smoke' },
      },
    },
  })
  const created = await rpc('session/new', args('actor-a'))

  await rpc('session/load', { ...args('actor-b'), sessionId: created.sessionId })
  const config = async (configId, value) =>
    rpc('session/set_config_option', { sessionId: created.sessionId, configId, value })
  const second = await config('model', 'smoke-second')

  assert.equal(
    second.configOptions.find((option) => option.id === 'model').currentValue,
    'smoke-second',
  )
  assert.equal(
    second.configOptions.some((option) => option.id === 'fast-mode'),
    false,
  )
  await config('model', 'smoke-model')
  const high = await config('reasoning_effort', 'high')

  assert.equal(
    high.configOptions.find((option) => option.id === 'reasoning_effort').currentValue,
    'high',
  )
  const fast = await config('fast-mode', 'on')

  assert.equal(fast.configOptions.find((option) => option.id === 'fast-mode').currentValue, 'on')
  await rpc('session/prompt', {
    sessionId: created.sessionId,
    prompt: [{ type: 'text', text: 'Fixture prompt' }],
  })
  const calls = readFileSync(`${base}/requests.jsonl`, 'utf8').trim().split('\n').map(JSON.parse)
  const start = calls.find((c) => c.method === 'thread/start')
  const resume = calls.find((c) => c.method === 'thread/resume')

  assert.notEqual(start.params.config.shell_environment_policy.set.HOME, base)
  assert.equal(
    start.params.config.shell_environment_policy.set.HOME,
    resume.params.config.shell_environment_policy.set.HOME,
  )
  assert.equal(start.params.config.developer_instructions, 'context actor-a')
  assert.equal(start.params.config.shell_environment_policy.set.NUPHOS_TOKEN, 'actor-a')
  assert.equal(resume.params.config.developer_instructions, 'context actor-b')
  assert.equal(resume.params.config.shell_environment_policy.set.NUPHOS_TOKEN, 'actor-b')
  for (const request of [start, resume]) {
    const { nuphos } = request.params.config.mcp_servers

    assert.equal(nuphos.args[1], 'http://fixture.invalid/mcp')
    assert.deepEqual(nuphos.env, { OPENAB_CREDENTIALS_DIR: base })
    assert.equal(nuphos.tool_timeout_sec, 1800)
    assert.equal(request.params.config.shell_environment_policy.set.OPENAB_CREDENTIALS_DIR, base)
    assert.equal(request.params.config.shell_environment_policy.set.GOMEMLIMIT, '6GiB')
    assert.equal(
      request.params.config.shell_environment_policy.set.NODE_OPTIONS,
      '--max-old-space-size=6144',
    )
  }
  const turn = calls.find((call) => call.method === 'turn/start')

  assert.equal(turn.params.model, 'smoke-model')
  assert.equal(turn.params.effort, 'high')
  assert.equal(turn.params.serviceTier, 'fast')
  const astra = await config('model', 'gpt-6-astra')

  assert.equal(
    astra.configOptions.find((option) => option.id === 'model').currentValue,
    'gpt-6-astra',
  )
  await config('reasoning_effort', 'ultra')
  const astraFast = await config('fast-mode', 'on')

  assert.equal(
    astraFast.configOptions.find((option) => option.id === 'fast-mode').description,
    'Faster responses, increased usage',
  )
  await rpc('session/prompt', {
    sessionId: created.sessionId,
    prompt: [{ type: 'text', text: 'Fixture Astra prompt' }],
  })
  const astraTurn = readFileSync(`${base}/requests.jsonl`, 'utf8')
    .trim()
    .split('\n')
    .map(JSON.parse)
    .findLast((call) => call.method === 'turn/start')

  assert.equal(astraTurn.params.model, 'gpt-6-astra')
  assert.equal(astraTurn.params.effort, 'ultra')
  assert.equal(astraTurn.params.serviceTier, 'fast')
  const defaultArgs = args('defaults-actor')

  defaultArgs._meta['ai.nuphos/runtimeDefaults'] = {
    model: 'gpt-6-astra',
    fast: 'on',
    effort: 'ultra',
  }
  const withDefaults = await rpc('session/new', defaultArgs)

  assert.equal(
    withDefaults.configOptions.find((entry) => entry.id === 'model').currentValue,
    'gpt-6-astra',
  )
  assert.equal(
    withDefaults.configOptions.find((entry) => entry.id === 'reasoning_effort').currentValue,
    'ultra',
  )
  assert.equal(
    withDefaults.configOptions.find((entry) => entry.id === 'fast-mode').currentValue,
    'on',
  )
  await rpc('session/prompt', {
    sessionId: withDefaults.sessionId,
    prompt: [{ type: 'text', text: 'First prompt with defaults' }],
  })
  const defaultTurn = readFileSync(`${base}/requests.jsonl`, 'utf8')
    .trim()
    .split('\n')
    .map(JSON.parse)
    .findLast((call) => call.method === 'turn/start')

  assert.equal(defaultTurn.params.model, 'gpt-6-astra')
  assert.equal(defaultTurn.params.effort, 'ultra')
  assert.equal(defaultTurn.params.serviceTier, 'fast')
  // Discover models against the real pinned adapter. Only the executable shim
  // supplies the offline App Server fixture; no live account.
  const modelCalls = join(base, 'model-discovery.jsonl')

  writeFileSync(
    join(base, 'codex-acp'),
    `#!/usr/bin/env node
const { spawn } = require('node:child_process');
if (process.env.OPENAB_ACP_AUTH_KEY) process.exit(10);
const child = spawn(process.execPath, [${JSON.stringify(join(base, 'patched.mjs'))}], {
  stdio: 'inherit', env: { ...process.env,
    CODEX_PATH: ${JSON.stringify(fileURLToPath(new URL('./fixtures/codex-app-server.mjs', import.meta.url)))},
    NUPHOS_SMOKE_RECORD: ${JSON.stringify(modelCalls)}
  }
});
child.on('exit', code => process.exit(code ?? 1));
`,
    { mode: 0o755 },
  )
  const discoverSettings = (model) =>
    spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('./model-discovery.mjs', import.meta.url)),
        'codex',
        ...(model ? [model] : []),
      ],
      {
        env: {
          PATH: `${base}:${process.env.PATH}`,
          HOME: base,
          ACP_DISCOVERY_CWD: base,
          OPENAB_ACP_AUTH_KEY: 'fixture-private',
        },
        encoding: 'utf8',
        timeout: 30_000,
      },
    )

  const discovery = discoverSettings()

  assert.equal(discovery.status, 0, discovery.stderr)
  assert.deepEqual(
    JSON.parse(discovery.stdout).models.map((model) => model.id),
    ['smoke-model', 'smoke-second', 'gpt-6-astra'],
  )
  const ultra = discoverSettings('gpt-6-astra')

  assert.equal(ultra.status, 0, ultra.stderr)
  assert.equal(JSON.parse(ultra.stdout).controls.modelId, 'gpt-6-astra')
  assert.ok(JSON.parse(ultra.stdout).controls.effort.some((option) => option.value === 'ultra'))
  assert.equal(JSON.parse(ultra.stdout).controls.fast, true)
  const standard = discoverSettings('smoke-second')

  assert.equal(standard.status, 0, standard.stderr)
  assert.equal(JSON.parse(standard.stdout).controls.fast, false)
  assert.equal(
    JSON.parse(standard.stdout).controls.effort.some((option) => option.value === 'ultra'),
    false,
  )
  assert.equal(
    readFileSync(modelCalls, 'utf8')
      .trim()
      .split('\n')
      .map(JSON.parse)
      .some((call) => call.method === 'turn/start'),
    false,
  )
  console.log(
    'PASS pinned codex-acp 1.1.4: initialize, session/new, session/load, actor-scoped instructions/env/MCP, model/effort/fast and runtime defaults reach turn/start; model discovery reads the catalog without a prompt',
  )
} finally {
  const exited = once(child, 'exit')

  child.stdin.end()
  child.kill()
  await exited
  rmSync(base, { recursive: true, force: true })
}
