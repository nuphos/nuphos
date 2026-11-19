import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { prepareClaudeHome, prepareIsolatedAgentHome } from './agent-home.ts'
import { openabConfigToml, openabEnv } from './config.ts'
import {
  codexProviderConfig,
  customProviderLaunch,
  parseCustomProvider,
  readCustomProviders,
  saveCustomProvider,
  withProviderKey,
  withProviderStatus,
} from './custom-provider.ts'

import type { LocalRuntimeLaunch } from './config.ts'
import type { KeyStore } from './custom-provider.ts'

function memoryStore(): KeyStore & { items: Map<string, string> } {
  const items = new Map<string, string>()

  return {
    items,
    get: async (account) => items.get(account) ?? null,
    set: async (account, token) => {
      items.set(account, token)
    },
    delete: async (account) => {
      items.delete(account)
    },
  }
}

function tempDir(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'custom-provider-'))

  t.after(() => rmSync(root, { recursive: true, force: true }))

  // An account's directory, `users/<userId>`, which its agents' homes sit in.
  return path.join(root, 'users', 'u1')
}

const gateway = { baseUrl: 'https://gw.example.com/anthropic', models: ['glm-4.6', 'kimi-k2'] }

test('a base URL is HTTPS, or HTTP to this computer, and never carries credentials', () => {
  assert.deepEqual(parseCustomProvider({ ...gateway, models: [' glm-4.6 ', '', 'glm-4.6'] }), {
    baseUrl: gateway.baseUrl,
    models: ['glm-4.6'],
  })
  assert.equal(
    parseCustomProvider({ baseUrl: 'http://localhost:4000' }).baseUrl,
    'http://localhost:4000',
  )
  for (const baseUrl of ['http://gw.example.com', 'https://u:p@gw.example.com', 'gw.example.com'])
    assert.throws(() => parseCustomProvider({ baseUrl }))
  assert.throws(() => parseCustomProvider({ ...gateway, models: ['two words'] }))
})

test('the key goes only to the credential store, and an edit without one keeps it', async (t) => {
  const dir = tempDir(t)
  const store = memoryStore()

  await assert.rejects(saveCustomProvider(store, dir, 'u1', 'codex', gateway), /API key/u)
  await saveCustomProvider(store, dir, 'u1', 'codex', { ...gateway, apiKey: 'sk-gw-secret' })
  await saveCustomProvider(store, dir, 'u1', 'codex', { ...gateway, models: ['kimi-k2'] })

  assert.equal(store.items.get('u1:codex'), 'sk-gw-secret')
  assert.doesNotMatch(readFileSync(path.join(dir, 'custom-providers.json'), 'utf8'), /sk-gw/u)
  assert.deepEqual(readCustomProviders(dir).codex?.models, ['kimi-k2'])
  assert.deepEqual(await customProviderLaunch(store, 'codex', path.join(dir, 'codex-home')), {
    models: ['kimi-k2'],
    env: { NUPHOS_CODEX_PROVIDER_KEY: 'sk-gw-secret' },
  })

  await saveCustomProvider(store, dir, 'u1', 'codex', null)
  assert.equal(store.items.size, 0)
  assert.equal(await customProviderLaunch(store, 'codex', path.join(dir, 'codex-home')), undefined)
})

test('without a credential store nothing is saved', async (t) => {
  const dir = tempDir(t)
  const store = memoryStore()

  store.set = () => Promise.reject(new Error('the keychain is used only by the packaged app'))
  await assert.rejects(
    saveCustomProvider(store, dir, 'u1', 'claude-code', { ...gateway, apiKey: 'sk-gw' }),
    /secure credential store/u,
  )
  assert.deepEqual(readCustomProviders(dir), {})
})

test('Claude Code gets the gateway and its models in its own settings, not the key', async (t) => {
  const dir = tempDir(t)
  const store = memoryStore()
  const workspace = path.join(dir, 'workspace')

  // An API-key sign-in would send that Anthropic key to the gateway too.
  prepareClaudeHome(dir, workspace)
  writeFileSync(
    path.join(dir, 'claude-home', 'settings.json'),
    JSON.stringify({ env: { ANTHROPIC_API_KEY: 'sk-ant-old' } }),
  )
  await saveCustomProvider(store, dir, 'u1', 'claude-code', { ...gateway, apiKey: 'sk-gw' })
  const home = prepareClaudeHome(dir, workspace) ?? ''
  const settings = JSON.parse(readFileSync(path.join(home, 'settings.json'), 'utf8')) as Record<
    string,
    unknown
  >

  assert.deepEqual(settings.env, { ANTHROPIC_BASE_URL: gateway.baseUrl })
  assert.deepEqual(settings.availableModels, gateway.models)
  assert.equal(settings.model, 'glm-4.6')
  assert.equal(
    (await customProviderLaunch(store, 'claude-code', home))?.env.ANTHROPIC_AUTH_TOKEN,
    'sk-gw',
  )

  // An added agent keeps a directory of its own and never picks the provider up.
  const added = path.join(dir, 'instances', 'i1')
  const addedHome = prepareIsolatedAgentHome('claude-code', added, workspace) ?? ''

  assert.doesNotMatch(readFileSync(path.join(addedHome, 'settings.json'), 'utf8'), /gw\.example/u)
  assert.equal(await customProviderLaunch(store, 'claude-code', addedHome), undefined)
})

test('Codex gets its own provider entry at the top of config.toml, replaced in place', () => {
  const base = 'notify = ["x"]\n\n[plugins."p"]\nenabled = true\n'
  const once = codexProviderConfig(base, gateway)

  assert.equal(
    once,
    [
      '# Nuphos custom provider (begin)',
      'model_provider = "nuphos-custom"',
      'model = "glm-4.6"',
      'model_providers.nuphos-custom = { name = "Custom provider", base_url = "https://gw.example.com/anthropic", env_key = "NUPHOS_CODEX_PROVIDER_KEY" }',
      '# Nuphos custom provider (end)',
      base,
    ].join('\n'),
  )
  assert.equal(codexProviderConfig(once, gateway), once)
  assert.equal(codexProviderConfig(once, undefined), base)
})

test('openab passes the key on by name, so its config file never holds it', () => {
  const adapter = { entry: '/b/a.js', bridge: '/b/bridge.mjs', version: 'v' }
  const launch: LocalRuntimeLaunch = {
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
    env: { HOME: '/home/me' },
    secretEnv: { ANTHROPIC_AUTH_TOKEN: 'sk-gw-secret' },
  }
  const toml = openabConfigToml(launch)

  assert.match(toml, /^inherit_env = \["ANTHROPIC_AUTH_TOKEN"\]$/mu)
  assert.doesNotMatch(toml, /sk-gw-secret/u)
  assert.equal(openabEnv(launch).ANTHROPIC_AUTH_TOKEN, 'sk-gw-secret')
})

test('a saved provider stands in for the sign-in, and its key reaches only openab', async (t) => {
  const dir = tempDir(t)
  const store = memoryStore()
  const home = path.join(dir, 'codex-home')
  const signedOut = { installed: true as const, path: '/bin/codex', loggedIn: false }
  const probe = withProviderStatus(() => Promise.resolve(signedOut), store)
  const started: (Record<string, string> | undefined)[] = []
  const process = withProviderKey(
    {
      start: (options) => {
        started.push(options.secretEnv)

        return Promise.resolve({ port: 1, authKey: 'k', controlKey: 'c' })
      },
      stop: () => Promise.resolve(),
      onExit: () => () => {},
    },
    store,
  )
  const options = { provider: 'codex' as const, agentHome: home } as Parameters<
    typeof process.start
  >[0]

  assert.deepEqual(await probe('codex', {}, home), signedOut)
  await process.start(options)
  await saveCustomProvider(store, dir, 'u1', 'codex', { ...gateway, apiKey: 'sk-gw' })
  assert.deepEqual(await probe('codex', {}, home), {
    ...signedOut,
    loggedIn: true,
    customProvider: 'gw.example.com',
  })
  await process.start(options)
  assert.deepEqual(started, [undefined, { NUPHOS_CODEX_PROVIDER_KEY: 'sk-gw' }])
})

test('a key the store will not delete keeps the provider listed; a key already gone does not', async (t) => {
  const dir = tempDir(t)
  const store = memoryStore()
  const remove = store.delete

  await saveCustomProvider(store, dir, 'u1', 'codex', { ...gateway, apiKey: 'sk-gw' })
  store.delete = () => Promise.reject(new Error('User canceled the operation.'))
  await assert.rejects(saveCustomProvider(store, dir, 'u1', 'codex', null), /canceled/u)
  assert.ok(readCustomProviders(dir).codex)
  assert.equal(store.items.get('u1:codex'), 'sk-gw')

  // The store resolves a delete of a missing item, as `deletePassword` resolves false.
  store.delete = remove
  store.items.clear()
  await saveCustomProvider(store, dir, 'u1', 'codex', null)
  assert.deepEqual(readCustomProviders(dir), {})
})

test('a key that cannot be read signs the agent out and keeps it from starting', async (t) => {
  const dir = tempDir(t)
  const store = memoryStore()
  const home = path.join(dir, 'claude-home')
  const cli = { installed: true as const, path: '/bin/claude', loggedIn: true }
  const probe = withProviderStatus(() => Promise.resolve(cli), store)
  let started = 0
  const process = withProviderKey(
    {
      start: () => {
        started += 1

        return Promise.resolve({ port: 1, authKey: 'k', controlKey: 'c' })
      },
      stop: () => Promise.resolve(),
      onExit: () => () => {},
    },
    store,
  )
  const options = { provider: 'claude-code' as const, agentHome: home } as Parameters<
    typeof process.start
  >[0]

  await saveCustomProvider(store, dir, 'u1', 'claude-code', { ...gateway, apiKey: 'sk-gw' })
  for (const unreadable of [
    () => Promise.reject(new Error('The keychain is locked.')),
    () => Promise.resolve(null),
  ]) {
    store.get = unreadable
    assert.deepEqual(await probe('claude-code', {}, home), {
      ...cli,
      loggedIn: false,
      customProvider: 'gw.example.com',
    })
    await assert.rejects(process.start(options))
  }
  assert.equal(started, 0)
})
