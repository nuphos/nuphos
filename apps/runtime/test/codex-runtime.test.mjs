import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, after } from 'node:test'

import { patchAdapter } from '../image/codex-acp/patch-adapter.mjs'
import { nuphosCodexSessionConfig } from '../image/codex-acp/session-config.mjs'

const runtimeHome = mkdtempSync(join(tmpdir(), 'nuphos-runtime-env-'))
const runtimeEnv = { HOME: runtimeHome, PATH: process.env.PATH }
after(() => rmSync(runtimeHome, { recursive: true, force: true }))

const config = {
  mcp_servers: {
    nuphos: { url: 'http://test/mcp', http_headers: { Authorization: 'Bearer actor-a' } },
  },
  model: 'test',
}

function nodeHeapLimit(args, env) {
  return Number(
    execFileSync(
      process.execPath,
      [...args, '-e', 'console.log(require("node:v8").getHeapStatistics().heap_size_limit)'],
      { env, encoding: 'utf8' },
    ),
  )
}

test('Codex new/resume context keeps instructions, MCP, and shell credentials scoped to each actor', () => {
  const actorA = nuphosCodexSessionConfig(
    config,
    {
      'ai.nuphos/codex': {
        developerInstructions: 'context A',
        env: {
          NUPHOS_TOKEN: 'actor-a',
          NUPHOS_SESSION_ID: 'session-a',
          NUPHOS_PLAN_API_TOKEN: 'actor-a',
          OPENAB_ACP_AUTH_KEY: 'blocked',
        },
      },
    },
    runtimeEnv,
  )
  const actorB = nuphosCodexSessionConfig(
    { ...config, mcp_servers: {} },
    {
      'ai.nuphos/codex': {
        developerInstructions: 'context B',
        env: { NUPHOS_TOKEN: 'actor-b', NUPHOS_SESSION_ID: 'session-b' },
      },
    },
    runtimeEnv,
  )

  assert.notEqual(
    actorA.shell_environment_policy.set.HOME,
    actorB.shell_environment_policy.set.HOME,
  )
  assert.equal(actorA.developer_instructions, 'context A')
  assert.equal(actorA.shell_environment_policy.set.NUPHOS_PLAN_API_TOKEN, 'actor-a')
  assert.equal(actorA.shell_environment_policy.set.OPENAB_ACP_AUTH_KEY, undefined)
  assert.equal(actorA.shell_environment_policy.inherit, 'none')
  assert.equal(actorA.mcp_servers.nuphos.tool_timeout_sec, 1800)
  assert.equal(actorB.shell_environment_policy.set.NUPHOS_TOKEN, 'actor-b')
  assert.equal(JSON.stringify(actorB).includes('actor-a'), false)
  assert.equal(config.shell_environment_policy, undefined)
  assert.equal(nuphosCodexSessionConfig(config, {}).model, 'test')
  assert.equal(
    nuphosCodexSessionConfig(actorA, { 'ai.nuphos/codex': {} }).developer_instructions,
    '',
  )
})

test('Codex shell inherits only baseline variables and explicitly scoped credentials', () => {
  const result = nuphosCodexSessionConfig(
    {},
    { 'ai.nuphos/codex': { env: { NUPHOS_TOKEN: 'scoped', NUPHOS_SESSION_ID: 'scoped-session' } } },
    {
      PATH: '/usr/bin:/bin',
      HOME: runtimeHome,
      OPENAB_ACP_AUTH_KEY: 'pod-wide',
      NUPHOS_TOKEN: 'stale',
    },
  )

  assert.equal(result.shell_environment_policy.inherit, 'none')
  const env = result.shell_environment_policy.set
  assert.notEqual(env.HOME, runtimeHome)
  assert.equal(env.NUPHOS_TOKEN, 'scoped')
  assert.equal(env.OPENAB_ACP_AUTH_KEY, undefined)
  assert.ok(env.PATH.endsWith('/usr/bin:/bin'))
})

test('adapter upgrades fail closed until the pinned patch is reviewed', () => {
  assert.throws(() => patchAdapter('unexpected bundle', ''), /bundle changed/)
})

test('Codex new/resume preserves managed memory budgets without trusting actor overrides', () => {
  const processEnv = {
    PATH: process.env.PATH,
    GOMEMLIMIT: '6GiB',
    NODE_OPTIONS: '--max-old-space-size=6144',
    GOFLAGS: '-p=2',
    MAKEFLAGS: '-j2',
    BASH_ENV: '/opt/nuphos-runtime/runtime-guard.sh',
  }
  const context = {
    'ai.nuphos/codex': {
      env: {
        GOMEMLIMIT: 'off',
        NODE_OPTIONS: '--max-old-space-size=8192',
        GOFLAGS: '-p=64',
        MAKEFLAGS: '-j64',
        BASH_ENV: '/opt/actor-supplied/guard.sh',
      },
    },
  }
  const started = nuphosCodexSessionConfig({}, context, processEnv)
  const resumed = nuphosCodexSessionConfig(started, context, processEnv)

  for (const session of [started, resumed]) {
    const env = session.shell_environment_policy.set

    assert.equal(env.GOMEMLIMIT, '6GiB')
    assert.equal(env.NODE_OPTIONS, '--max-old-space-size=6144')
    // Fan-out caps and the guard that installs the hard RLIMIT_DATA ceiling
    // have to survive inherit: 'none' too, and an actor must not be able to
    // widen them or point BASH_ENV at a script of its own.
    assert.equal(env.GOFLAGS, '-p=2')
    assert.equal(env.MAKEFLAGS, '-j2')
    assert.equal(env.BASH_ENV, '/opt/nuphos-runtime/runtime-guard.sh')
    // heap_size_limit includes more than old-space, and its overhead differs
    // across Node/V8 versions and architectures. Compare with an explicit CLI
    // flag on this same binary instead of assuming a fixed total heap size.
    const inherited = nodeHeapLimit([], env)
    const { NODE_OPTIONS: _nodeOptions, ...withoutHeapOption } = env

    assert.equal(inherited, nodeHeapLimit(['--max-old-space-size=6144'], withoutHeapOption))
    assert.ok(inherited > nodeHeapLimit(['--max-old-space-size=256'], withoutHeapOption))
  }
  assert.equal(
    nuphosCodexSessionConfig({}, context, {}).shell_environment_policy.set.NODE_OPTIONS,
    undefined,
  )
})

test('Codex login seeding preserves refreshes on restart and replaces credentials on rebind', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nuphos-codex-auth-test-'))
  const auth = join(dir, 'auth.json')
  const seed = join(dir, 'seed.json')

  try {
    writeFileSync(seed, '{"tokens":"original"}')
    const run = (revision) =>
      execFileSync('/bin/sh', ['image/seed-codex-auth.sh'], {
        env: {
          ...process.env,
          NUPHOS_AUTH_REVISION: revision,
          NUPHOS_CODEX_AUTH_DIRECTORY: dir,
          NUPHOS_CODEX_AUTH_SOURCE: seed,
        },
      })

    const revision = (value) => createHash('sha256').update(value).digest('hex').slice(0, 16)
    const first = revision(readFileSync(seed))

    run(first)
    assert.equal(readFileSync(auth, 'utf8'), '{"tokens":"original"}')
    assert.equal(statSync(auth).mode & 0o777, 0o600)
    writeFileSync(auth, '{"tokens":"refreshed"}')
    run(first)
    assert.equal(readFileSync(auth, 'utf8'), '{"tokens":"refreshed"}')
    writeFileSync(seed, '{"tokens":"new-binding"}')
    assert.throws(() => run('mismatched-revision'), /revision changed/)
    assert.equal(readFileSync(auth, 'utf8'), '{"tokens":"refreshed"}')
    assert.equal(readFileSync(join(dir, '.nuphos-auth-revision'), 'utf8'), first)
    run(revision(readFileSync(seed)))
    assert.equal(readFileSync(auth, 'utf8'), '{"tokens":"new-binding"}')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
