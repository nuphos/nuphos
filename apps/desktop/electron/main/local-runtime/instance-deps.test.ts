import assert from 'node:assert/strict'
import test from 'node:test'

import { instanceControllerDeps } from './instance-deps.ts'

import type { AgentCliStatus, LocalAgentProvider } from './agent-cli.ts'
import type { LocalRuntimeControllerDeps } from './controller-types.ts'
import type { CliInstall } from './instance-deps.ts'

const missing = { installed: false } as AgentCliStatus
const present = { installed: true, loggedIn: false, path: '/bin/claude' } as AgentCliStatus

function added(
  installCli: NonNullable<LocalRuntimeControllerDeps['installCli']>,
  provider: LocalAgentProvider = 'claude-code',
) {
  let installed = false
  const seen: CliInstall[] = []
  const install: CliInstall = {}
  const deps = instanceControllerDeps(
    {
      probeCli: () => Promise.resolve(installed ? present : missing),
      userEnv: () => Promise.resolve({}),
      installCli: async (provider: LocalAgentProvider, env: NodeJS.ProcessEnv) => {
        await installCli(provider, env)
        installed = true
      },
    } as unknown as LocalRuntimeControllerDeps,
    'instance-dir',
    'u1',
    () => seen.push({ ...install }),
    { install },
  )

  return { probe: () => deps.probeCli(provider, {}, undefined), install, seen }
}

test('an added agent whose CLI is missing installs it, says so meanwhile, and runs it', async () => {
  let calls = 0
  const { probe, seen } = added(() => {
    calls++

    return Promise.resolve()
  })

  assert.deepEqual(await probe(), present)
  assert.equal(calls, 1)
  assert.deepEqual(seen, [{ tried: true, installing: true }, { tried: true }])
})

test('an added agent of any kind but Antigravity installs its missing CLI', async () => {
  for (const kind of ['codex', 'pi', 'grok', 'hermes', 'opencode', 'dsh'] as const) {
    const asked: LocalAgentProvider[] = []
    const { probe } = added((provider) => {
      asked.push(provider)

      return Promise.resolve()
    }, kind)

    assert.deepEqual(await probe(), present)
    assert.deepEqual(asked, [kind])
  }
  // Antigravity comes only as a desktop app, so there is nothing to run.
  const { probe } = added(() => assert.fail('Antigravity has no installer'), 'antigravity')

  assert.deepEqual(await probe(), missing)
})

test('an install that fails twice is reported and not tried again', async () => {
  let calls = 0
  const { probe, install } = added(() => {
    calls++

    return Promise.reject(new Error('curl: (6) Could not resolve host: claude.ai'))
  })

  assert.deepEqual(await probe(), missing)
  assert.deepEqual(await probe(), missing)
  assert.equal(calls, 2)
  assert.equal(install.error, 'curl: (6) Could not resolve host: claude.ai')
})

test('an install that fails once is tried again', async () => {
  let calls = 0
  const { probe } = added(() =>
    ++calls === 1 ? Promise.reject(new Error('curl: (56) reset')) : Promise.resolve(),
  )

  assert.deepEqual(await probe(), present)
  assert.equal(calls, 2)
})

test('an agent this computer already had only probes', async () => {
  let calls = 0
  const deps = instanceControllerDeps(
    {
      probeCli: () => Promise.resolve(missing),
      installCli: () => {
        calls++

        return Promise.resolve()
      },
    } as unknown as LocalRuntimeControllerDeps,
    'instance-dir',
    'u1',
    () => {},
  )

  assert.deepEqual(await deps.probeCli('claude-code', {}, undefined), missing)
  assert.equal(calls, 0)
})

test('a shared token’s agent signs in with that token only, never the shell’s', async () => {
  const deps = instanceControllerDeps(
    {
      userEnv: () =>
        Promise.resolve({
          PATH: '/bin',
          CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-fictional-shell',
          ANTHROPIC_API_KEY: 'sk-ant-fictional-shell',
        }),
      probeCli: () => Promise.resolve(present),
    } as unknown as LocalRuntimeControllerDeps,
    'instance-dir',
    'u1',
    () => undefined,
    {
      vault: {
        owner: 'alice',
        name: 'Alice',
        read: () => Promise.resolve('sk-ant-oat01-fictional'),
      },
    },
  )
  const env = await deps.userEnv()

  assert.equal(env.PATH, '/bin')
  assert.equal(typeof env.NUPHOS_VAULT_SOCKET, 'string')
  assert.match(env.NUPHOS_VAULT_KEY ?? '', /^[0-9a-f]{64}$/u)
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, undefined)
  assert.equal(env.ANTHROPIC_API_KEY, undefined)
  // Its own home holds no login: the token is its sign-in.
  assert.deepEqual(await deps.probeCli('claude-code', env, undefined), {
    ...present,
    loggedIn: true,
  })
  assert.deepEqual(await deps.probeCli('claude-code', {}, undefined), {
    ...present,
    loggedIn: true,
  })
})

test('an added agent of its own login is told of no token', async () => {
  const deps = instanceControllerDeps(
    {
      userEnv: () => Promise.resolve({ PATH: '/bin' }),
      probeCli: () => Promise.resolve(present),
    } as unknown as LocalRuntimeControllerDeps,
    'instance-dir',
    'u1',
    () => undefined,
  )
  const env = await deps.userEnv()

  assert.equal(env.NUPHOS_VAULT_SOCKET, undefined)
  assert.deepEqual(await deps.probeCli('claude-code', env, undefined), present)
})
