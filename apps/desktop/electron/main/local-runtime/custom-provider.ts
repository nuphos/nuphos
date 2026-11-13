// A model provider of the user's own (a gateway, a proxy, another vendor's compatible API) for
// this computer's Claude Code and Codex, wired the way each CLI already supports one. The base
// URL and model ids are kept in a file; the key only in the OS credential store, and it reaches
// the agent only through process environments, never a file Nuphos writes.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type { LocalRuntimeControllerDeps, RuntimeProcess } from './controller-types.ts'
import type { LocalAgentProvider } from './providers.ts'

export type CustomProviderAgent = 'claude-code' | 'codex'
export type CustomProvider = { baseUrl: string; models: string[] }

/** What a launch needs: the key in the CLI's own variable, and the models to report. */
export type CustomProviderLaunch = { models: string[]; env: Record<string, string> }

/**
 * Where the keys are kept: the OS credential store in the app (`keychainFor` in
 * auth/token-store.ts). Only its shape is named here, so code that reaches this module, the
 * backend's tests among it, never needs the store's native module.
 */
export type KeyStore = {
  get: (account: string) => Promise<string | null>
  set: (account: string, key: string) => Promise<void>
  delete: (account: string) => Promise<unknown>
}

/** The credential store's service the keys are kept under, one item per account and agent. */
export const PROVIDER_KEYCHAIN_SERVICE = 'ai.nuphos.desktop.provider'

/** Claude Code's gateway token, and the variable Codex's provider names as its `env_key`. */
export const PROVIDER_KEY_ENV: Record<CustomProviderAgent, string> = {
  'claude-code': 'ANTHROPIC_AUTH_TOKEN',
  codex: 'NUPHOS_CODEX_PROVIDER_KEY',
}

const FILE = 'custom-providers.json'
const MAX_MODELS = 50
const MODEL_ID = /^[\w.:/@[\]-]{1,200}$/u
const KEY = /^\S{1,4096}$/u
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

const isAgent = (provider: unknown): provider is CustomProviderAgent =>
  provider === 'claude-code' || provider === 'codex'

const account = (userId: string, provider: CustomProviderAgent) => `${userId}:${provider}`

/** HTTPS, or plain HTTP to a gateway on this computer; never credentials in the URL. */
export function parseCustomProvider(value: unknown): CustomProvider {
  const { baseUrl, models } = (value ?? {}) as { baseUrl?: unknown; models?: unknown }
  let url: URL

  try {
    url = new URL(typeof baseUrl === 'string' ? baseUrl.trim() : '')
  } catch {
    throw new Error('Enter the base URL, starting with https://.')
  }
  if (
    !(url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname))) ||
    url.username ||
    url.password
  )
    throw new Error('The base URL must use https://, or http:// to this computer.')
  const ids = [
    ...new Set(
      (Array.isArray(models) ? models : []).map((id) => (typeof id === 'string' ? id.trim() : '')),
    ),
  ].filter(Boolean)

  if (ids.length > MAX_MODELS || ids.some((id) => !MODEL_ID.test(id)))
    throw new Error('Enter up to 50 model IDs, one per line, without spaces.')

  return { baseUrl: (baseUrl as string).trim(), models: ids }
}

export function readCustomProviders(
  userDir: string,
): Partial<Record<CustomProviderAgent, CustomProvider>> {
  try {
    const saved = JSON.parse(readFileSync(path.join(userDir, FILE), 'utf8')) as Record<
      string,
      unknown
    >

    return Object.fromEntries(
      Object.entries(saved).flatMap(([provider, value]) => {
        try {
          return isAgent(provider) ? [[provider, parseCustomProvider(value)]] : []
        } catch {
          return []
        }
      }),
    )
  } catch {
    return {}
  }
}

function writeCustomProvider(
  userDir: string,
  provider: CustomProviderAgent,
  value: CustomProvider | null,
): void {
  const { [provider]: _previous, ...others } = readCustomProviders(userDir)
  const saved = value ? { ...others, [provider]: value } : others

  mkdirSync(userDir, { recursive: true, mode: 0o700 })
  writeFileSync(path.join(userDir, FILE), `${JSON.stringify(saved, null, 2)}\n`, { mode: 0o600 })
}

/**
 * Saves a provider, its key first: without a credential store to hold the key nothing is
 * saved, since a key is never kept in a file. An edit without a key keeps the stored one.
 * Null removes both, the key first: a key the store will not delete keeps the provider listed,
 * so it is never shown as removed while its key stays behind. A key already gone is no error.
 */
export async function saveCustomProvider(
  store: KeyStore,
  userDir: string,
  userId: string,
  provider: unknown,
  value: unknown,
): Promise<void> {
  if (!isAgent(provider)) throw new Error('Unknown runtime.')
  if (value === null) {
    await store.delete(account(userId, provider))
    writeCustomProvider(userDir, provider, null)

    return
  }
  const parsed = parseCustomProvider(value)
  const raw = (value as { apiKey?: unknown }).apiKey
  const key = typeof raw === 'string' ? raw.trim() : ''

  if (key) {
    if (!KEY.test(key)) throw new Error('Paste the whole API key.')
    try {
      await store.set(account(userId, provider), key)
    } catch {
      throw new Error(
        'This computer has no secure credential store Nuphos can use, so the key was not saved.',
      )
    }
  } else if (!readCustomProviders(userDir)[provider]) throw new Error('Enter the API key.')
  writeCustomProvider(userDir, provider, parsed)
}

/**
 * The saved provider of the agent with this home, and its key; undefined without a provider.
 * Rejects when the key cannot be read, so the agent never starts without it.
 */
export async function customProviderLaunch(
  store: KeyStore,
  provider: LocalAgentProvider,
  agentHome: string,
): Promise<CustomProviderLaunch | undefined> {
  // A home sits in its account's directory, `users/<userId>`, beside the saved providers.
  const dir = path.dirname(agentHome)
  const saved = isAgent(provider) ? readCustomProviders(dir)[provider] : undefined

  if (!saved || !isAgent(provider)) return
  const key = await store.get(account(path.basename(dir), provider))

  if (!key) throw new Error('The custom provider’s API key is missing. Enter it again.')

  return { models: saved.models, env: { [PROVIDER_KEY_ENV[provider]]: key } }
}

/**
 * A CLI probe in which a saved provider stands in for the sign-in, found beside the home.
 * A key that cannot be read leaves the agent signed out, which the card reports as such.
 */
export function withProviderStatus(
  probe: LocalRuntimeControllerDeps['probeCli'],
  store: KeyStore,
): LocalRuntimeControllerDeps['probeCli'] {
  return async (provider, env, agentHome) => {
    const cli = await probe(provider, env, agentHome)
    const saved =
      agentHome && isAgent(provider) ? readCustomProviders(path.dirname(agentHome))[provider] : null

    if (!agentHome || !saved || !cli.installed) return cli
    const readable = await customProviderLaunch(store, provider, agentHome).then(
      () => true,
      () => false,
    )

    return { ...cli, loggedIn: readable, customProvider: new URL(saved.baseUrl).host }
  }
}

/**
 * An openab process that hands the saved provider's key to its agent. Found from the agent's
 * home, so an added agent, whose home is elsewhere, keeps its own sign-in.
 */
export function withProviderKey(process: RuntimeProcess, store: KeyStore): RuntimeProcess {
  return {
    start: async (options) => {
      const custom = await customProviderLaunch(store, options.provider, options.agentHome)

      return process.start(custom ? { ...options, secretEnv: custom.env } : options)
    },
    stop: () => process.stop(),
    onExit: (listener) => process.onExit(listener),
  }
}

/**
 * Claude Code's own gateway settings, whose `availableModels` lists exactly the given ids;
 * undefined without a provider. They replace an API-key sign-in's key, which would otherwise
 * go to the gateway as well.
 */
export function claudeProviderSettings(userDir: string) {
  const provider = readCustomProviders(userDir)['claude-code']

  if (!provider) return

  return {
    env: { ANTHROPIC_BASE_URL: provider.baseUrl },
    ...(provider.models.length > 0
      ? { availableModels: provider.models, model: provider.models[0] }
      : {}),
  }
}

const BEGIN = '# Nuphos custom provider (begin)'
const END = '# Nuphos custom provider (end)'
const CODEX_PROVIDER_ID = 'nuphos-custom'

/**
 * Codex's own `model_providers` entry, as root keys at the top of its config.toml: an inline
 * table needs no table header, so the block is one span that is easy to replace.
 */
export function codexProviderConfig(contents: string, provider: CustomProvider | undefined) {
  const begin = contents.indexOf(BEGIN)
  const end = contents.indexOf(END)
  const rest =
    begin === -1 || end < begin
      ? contents
      : contents.slice(0, begin) + contents.slice(end + END.length).replace(/^\n/u, '')

  if (!provider) return rest
  const table = [
    `name = "Custom provider"`,
    `base_url = ${JSON.stringify(provider.baseUrl)}`,
    `env_key = ${JSON.stringify(PROVIDER_KEY_ENV.codex)}`,
  ].join(', ')

  return [
    BEGIN,
    `model_provider = ${JSON.stringify(CODEX_PROVIDER_ID)}`,
    ...(provider.models[0] ? [`model = ${JSON.stringify(provider.models[0])}`] : []),
    `model_providers.${CODEX_PROVIDER_ID} = { ${table} }`,
    END,
    rest,
  ].join('\n')
}

/** Brings a Codex home's config.toml in line with the provider saved beside it. */
export function applyCodexProvider(userDir: string, config: string): void {
  const current = existsSync(config) ? readFileSync(config, 'utf8') : ''
  const next = codexProviderConfig(current, readCustomProviders(userDir).codex)

  if (next !== current) writeFileSync(config, next, { mode: 0o600 })
}
