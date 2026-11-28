import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { applyOpenCodeProvider, opencodeProviderConfig } from './custom-provider-opencode.ts'
import {
  customProviderLaunch,
  parseCustomProvider,
  providerAccount,
  readCustomProviders,
  saveCustomProvider,
} from './custom-provider.ts'

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

function tempRoot(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'custom-provider-opencode-'))

  t.after(() => rmSync(root, { recursive: true, force: true }))

  return root
}

const gateway = { baseUrl: 'https://gw.example.com/v1', models: ['glm-4.6', 'kimi-k2'] }
const azure = {
  baseUrl: 'https://acme-openai.openai.azure.com',
  models: ['gpt-4o-prod'],
  type: 'azure',
}

test('every runtime keeps a key of its own; this computer’s own agent keeps the item it had', () => {
  assert.equal(providerAccount('/data/users/u1', 'opencode'), 'u1:opencode')
  assert.equal(providerAccount('/data/instances/i1/users/u1', 'opencode'), 'u1:opencode:i1')
  assert.equal(providerAccount('/data/instances/i1/users/u1', 'claude-code'), 'u1:claude-code:i1')
  assert.equal(providerAccount('/data/users/u1', 'codex'), 'u1:codex')
})

test('Azure takes only a resource name, and OpenCode needs at least one model', () => {
  assert.deepEqual(parseCustomProvider(azure, 'opencode'), azure)
  assert.throws(
    () =>
      parseCustomProvider(
        { ...azure, baseUrl: 'https://acme-openai.openai.azure.com.evil.example' },
        'opencode',
      ),
    /resource name/u,
  )
  assert.throws(
    () => parseCustomProvider({ ...azure, models: [] }, 'opencode'),
    /at least one deployment name/u,
  )
  assert.throws(
    () => parseCustomProvider({ ...gateway, models: [' '] }, 'opencode'),
    /at least one model ID/u,
  )
  // Azure serves OpenAI's API, which Claude Code doesn't speak.
  assert.equal(parseCustomProvider(azure, 'claude-code').type, undefined)
})

test('two OpenCode runtimes keep separate providers and keys, launched with their own', async (t) => {
  const root = tempRoot(t)
  const store = memoryStore()
  const own = path.join(root, 'users', 'u1')
  const added = path.join(root, 'instances', 'i1', 'users', 'u1')

  await saveCustomProvider(store, own, 'opencode', { ...gateway, apiKey: 'sk-own' })
  await saveCustomProvider(store, added, 'opencode', { ...azure, apiKey: 'az-added' })

  assert.deepEqual(Object.fromEntries(store.items), {
    'u1:opencode': 'sk-own',
    'u1:opencode:i1': 'az-added',
  })
  assert.deepEqual(await customProviderLaunch(store, 'opencode', path.join(own, 'opencode-home')), {
    models: ['nuphos-custom/glm-4.6', 'nuphos-custom/kimi-k2'],
    env: { NUPHOS_OPENCODE_PROVIDER_KEY: 'sk-own' },
  })
  assert.deepEqual(
    await customProviderLaunch(store, 'opencode', path.join(added, 'opencode-home')),
    { models: ['azure/gpt-4o-prod'], env: { NUPHOS_OPENCODE_PROVIDER_KEY: 'az-added' } },
  )

  await saveCustomProvider(store, added, 'opencode', null)
  assert.deepEqual([...store.items.keys()], ['u1:opencode'])
  assert.equal(readCustomProviders(added).opencode, undefined)
})

test('a gateway on this computer needs no key; one elsewhere does', async (t) => {
  const store = memoryStore()
  const dir = path.join(tempRoot(t), 'users', 'u1')
  const local = { baseUrl: 'http://127.0.0.1:4000/v1', models: ['llama3'] }

  await assert.rejects(saveCustomProvider(store, dir, 'opencode', gateway), /API key/u)
  await saveCustomProvider(store, dir, 'opencode', local)
  assert.deepEqual(await customProviderLaunch(store, 'opencode', path.join(dir, 'opencode-home')), {
    models: ['nuphos-custom/llama3'],
    env: {},
  })
})

test('opencode.json names the provider and reads its key from the launch, never the file', (t) => {
  const dir = path.join(tempRoot(t), 'users', 'u1')
  const home = path.join(dir, 'opencode-home')
  const file = path.join(home, '.config', 'opencode', 'opencode.json')
  const read = () => JSON.parse(readFileSync(file, 'utf8'))

  // Nothing saved and no file: nothing is written.
  applyOpenCodeProvider(dir, home)
  assert.throws(() => readFileSync(file))

  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(
    file,
    JSON.stringify({ theme: 'dark', provider: { mine: { options: {} } }, model: 'mine/x' }),
  )
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'custom-providers.json'), JSON.stringify({ opencode: gateway }))
  applyOpenCodeProvider(dir, home)
  assert.deepEqual(read(), {
    theme: 'dark',
    provider: {
      mine: { options: {} },
      'nuphos-custom': {
        npm: '@ai-sdk/openai-compatible',
        name: 'Custom provider',
        options: { baseURL: gateway.baseUrl, apiKey: '{env:NUPHOS_OPENCODE_PROVIDER_KEY}' },
        models: { 'glm-4.6': { name: 'glm-4.6' }, 'kimi-k2': { name: 'kimi-k2' } },
      },
    },
    model: 'nuphos-custom/glm-4.6',
  })

  writeFileSync(path.join(dir, 'custom-providers.json'), JSON.stringify({ opencode: azure }))
  applyOpenCodeProvider(dir, home)
  assert.deepEqual(read().provider.azure, {
    options: { resourceName: 'acme-openai', apiKey: '{env:NUPHOS_OPENCODE_PROVIDER_KEY}' },
    models: { 'gpt-4o-prod': { name: 'gpt-4o-prod' } },
  })
  assert.equal(read().provider['nuphos-custom'], undefined)
  assert.equal(read().model, 'azure/gpt-4o-prod')

  // Removed: the user's own entries stay, ours go.
  writeFileSync(path.join(dir, 'custom-providers.json'), '{}')
  applyOpenCodeProvider(dir, home)
  assert.deepEqual(read(), { theme: 'dark', provider: { mine: { options: {} } } })
})

test('an Azure entry of the user’s own is left alone, until Azure is saved in its place', () => {
  const config = { provider: { azure: { options: { apiKey: '{env:MY_KEY}' } } }, model: 'azure/x' }

  assert.deepEqual(opencodeProviderConfig(config, undefined), config)
  assert.deepEqual(opencodeProviderConfig(config, parseCustomProvider(azure, 'opencode')), {
    provider: {
      azure: {
        options: { resourceName: 'acme-openai', apiKey: '{env:NUPHOS_OPENCODE_PROVIDER_KEY}' },
        models: { 'gpt-4o-prod': { name: 'gpt-4o-prod' } },
      },
    },
    model: 'azure/gpt-4o-prod',
  })
})

test('a model picked in OpenCode stays while the provider has it', () => {
  const pick = (model: string) => opencodeProviderConfig({ model }, gateway).model

  assert.equal(pick('nuphos-custom/kimi-k2'), 'nuphos-custom/kimi-k2')
  assert.equal(pick('nuphos-custom/gone'), 'nuphos-custom/glm-4.6')
  assert.equal(pick('mine/x'), 'nuphos-custom/glm-4.6')
})
