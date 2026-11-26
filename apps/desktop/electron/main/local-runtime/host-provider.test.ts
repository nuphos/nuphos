import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { prepareAgentHome } from './agent-home.ts'
import { openabConfigToml, openabEnv } from './config.ts'
import {
  CLAUDE_PROVIDER_ENV,
  CODEX_PROVIDER_ENV,
  hostProviderEnv,
  withHostProvider,
} from './host-provider.ts'

import type { LocalRuntimeLaunch } from './config.ts'
import type { LocalRuntimeControllerDeps } from './controller-types.ts'
import type { OpenabProcessOptions } from './openab-process.ts'

const bedrock = {
  PATH: '/usr/bin',
  CLAUDE_CODE_USE_BEDROCK: '1',
  AWS_REGION: 'us-east-1',
  AWS_BEARER_TOKEN_BEDROCK: 'bedrock-secret',
  OPENAI_BASE_URL: 'https://res.openai.azure.com/openai/v1',
  OPENAI_API_KEY: 'azure-secret',
  UNRELATED_TOKEN: 'other-secret',
}
const unset = { PATH: '/usr/bin', UNRELATED_TOKEN: 'other-secret' }
const secrets = /bedrock-secret|azure-secret|other-secret/u
const signedOut = { installed: true as const, path: '/bin/agent', loggedIn: false }
const adapter = { entry: '/b/a.js', bridge: '/b/bridge.mjs', version: 'v' }

/** The deps a host passes, recording what each agent's openab is started with. */
function hostDeps(env: NodeJS.ProcessEnv) {
  const started: (Record<string, string> | undefined)[] = []
  const printed: string[] = []
  const base = {
    probeCli: () => Promise.resolve(signedOut),
    prepareAgentHome,
    createProcess: () => ({
      start: (options: OpenabProcessOptions) => {
        started.push(options.secretEnv)

        return Promise.resolve({ port: 1, authKey: 'k', controlKey: 'c' })
      },
      stop: () => Promise.resolve(),
      onExit: () => () => undefined,
    }),
  } as unknown as LocalRuntimeControllerDeps
  const deps = withHostProvider(env, base, (line) => printed.push(line))

  return { base, deps, started, printed }
}

function launch(secretEnv: Record<string, string> | undefined): LocalRuntimeLaunch {
  return {
    provider: 'claude-code',
    bundle: { root: '/b', openab: '/b/openab', adapters: { 'claude-code': adapter } },
    adapter,
    nodeExecPath: '/node',
    cliPath: '/claude',
    agentHome: '/u/claude-home',
    workspace: '/u/workspace',
    openabHome: '/u/openab-home',
    port: 1,
    authKey: 'k',
    env: bedrock,
    ...(secretEnv ? { secretEnv } : {}),
  }
}

test('each agent gets only its own provider variables, and only those that are set', () => {
  assert.deepEqual(hostProviderEnv('claude-code', bedrock), {
    CLAUDE_CODE_USE_BEDROCK: '1',
    AWS_REGION: 'us-east-1',
    AWS_BEARER_TOKEN_BEDROCK: 'bedrock-secret',
  })
  assert.deepEqual(hostProviderEnv('codex', bedrock), { NUPHOS_CODEX_PROVIDER_KEY: 'azure-secret' })
  assert.deepEqual(hostProviderEnv('opencode', bedrock), {})
  assert.deepEqual(hostProviderEnv('claude-code', { PATH: '/usr/bin', AWS_REGION: ' ' }), {})
  assert.deepEqual(hostProviderEnv('codex', { OPENAI_BASE_URL: 'https://x.example' }), {})
})

test('the values reach openab by name; its config file never holds them', async () => {
  const { deps, started } = hostDeps(bedrock)
  const options = { provider: 'claude-code', agentHome: '/h', env: {} } as OpenabProcessOptions

  await deps.createProcess().start(options)
  const toml = openabConfigToml(launch(started[0]))

  assert.equal(openabEnv(launch(started[0])).AWS_BEARER_TOKEN_BEDROCK, 'bedrock-secret')
  assert.match(toml, /^inherit_env = \[.*"AWS_BEARER_TOKEN_BEDROCK".*\]$/mu)
  assert.doesNotMatch(toml, secrets)
})

test('without provider variables nothing changes and nothing is printed', () => {
  const { base, deps, printed } = hostDeps(unset)

  assert.equal(deps, base)
  assert.deepEqual(printed, [])
})

test('the host provider stands in for the sign-in, named without its secrets', async () => {
  const { deps, printed } = hostDeps(bedrock)

  assert.deepEqual(await deps.probeCli('claude-code', {}, '/h'), {
    ...signedOut,
    loggedIn: true,
    customProvider: 'Amazon Bedrock',
  })
  assert.deepEqual(await deps.probeCli('codex', {}, '/h'), {
    ...signedOut,
    loggedIn: true,
    customProvider: 'res.openai.azure.com',
  })
  assert.deepEqual(await deps.probeCli('opencode', {}, '/h'), signedOut)
  assert.equal(printed.length, 1)
  assert.match(printed[0] ?? '', /AWS_BEARER_TOKEN_BEDROCK.*\n.*OPENAI_API_KEY/u)
  assert.doesNotMatch(printed[0] ?? '', secrets)
})

test('an agent signed in with a token shared through the Vault gets none of it', async () => {
  const { deps, started } = hostDeps(bedrock)
  const shared = { NUPHOS_VAULT_SOCKET: '/s', NUPHOS_VAULT_KEY: 'k' }

  await deps.createProcess().start({ provider: 'claude-code', env: shared } as OpenabProcessOptions)
  assert.deepEqual(started, [undefined])
  assert.deepEqual(await deps.probeCli('claude-code', shared, '/h'), signedOut)
})

test('Codex gets the endpoint as its provider entry, which goes with the variables', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'host-provider-'))
  const config = path.join(dir, 'codex-home', 'config.toml')
  const runtimeEnv = { CODEX_HOME: path.join(dir, 'owner') }

  t.after(() => rmSync(dir, { recursive: true, force: true }))
  hostDeps(bedrock).deps.prepareAgentHome('codex', dir, dir, runtimeEnv)
  assert.match(
    readFileSync(config, 'utf8'),
    /base_url = "https:\/\/res\.openai\.azure\.com\/openai\/v1", env_key = "NUPHOS_CODEX_PROVIDER_KEY"/u,
  )
  assert.doesNotMatch(readFileSync(config, 'utf8'), secrets)
  hostDeps(unset).deps.prepareAgentHome('codex', dir, dir, runtimeEnv)
  assert.doesNotMatch(readFileSync(config, 'utf8'), /model_provider/u)
})

test('the CLI service forwards exactly the variables the host reads', () => {
  const service = readFileSync(
    path.join(import.meta.dirname, '../../../../cli/src/service.rs'),
    'utf8',
  )
  const list = /const PROVIDER: \[&str; \d+\] = \[([^\]]*)\]/u.exec(service)?.[1] ?? ''

  assert.deepEqual(
    [...list.matchAll(/"(\w+)"/gu)].map(([, name]) => name).sort(),
    [...CLAUDE_PROVIDER_ENV, ...CODEX_PROVIDER_ENV].sort(),
  )
})
