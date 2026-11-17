import assert from 'node:assert/strict'
import test from 'node:test'

import { instanceControllerDeps } from './instance-deps.ts'

import type { AgentCliStatus, LocalAgentProvider } from './agent-cli.ts'
import type { LocalRuntimeControllerDeps } from './controller-types.ts'
import type { CliInstall } from './instance-deps.ts'

const missing = { installed: false } as AgentCliStatus
const present = { installed: true, loggedIn: false, path: '/bin/claude' } as AgentCliStatus

function added(installCli: NonNullable<LocalRuntimeControllerDeps['installCli']>) {
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
    install,
  )

  return { probe: () => deps.probeCli('claude-code', {}, undefined), install, seen }
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

test('an agent added by someone who may not install only probes', async () => {
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
