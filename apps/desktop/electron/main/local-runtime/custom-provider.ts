// A model provider of the user's own (a gateway, a proxy, another vendor's compatible API) for
// this computer's Claude Code, Codex and OpenCode, wired the way each CLI already supports one.
// The base URL and model ids are kept in a file; the key only in the OS credential store, and it
// reaches the agent only through process environments, never a file Nuphos writes.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { atlasErrorInfo, buildAtlasError } from '../../atlas/error.ts'

import { CODEX_KEY_ENV, prepareCodexCatalog } from './custom-provider-codex.ts'
import { checkWithKey } from './custom-provider-probe.ts'

import type { CustomProviderCheck } from './custom-provider-probe.ts'
import type { LocalAgentProvider } from './providers.ts'

export type CustomProviderAgent = 'claude-code' | 'codex' | 'opencode'
/** `azure`: an Azure OpenAI resource, at `https://<resource>.openai.azure.com`; OpenCode only. */
export type CustomProvider = { baseUrl: string; models: string[]; type?: 'azure' }

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

/** Claude Code's gateway token, and the variables Codex's and OpenCode's configs name. */
export const PROVIDER_KEY_ENV: Record<CustomProviderAgent, string> = {
  'claude-code': 'ANTHROPIC_AUTH_TOKEN',
  codex: CODEX_KEY_ENV,
  opencode: 'NUPHOS_OPENCODE_PROVIDER_KEY',
}

/** OpenCode's provider of OpenAI's shape, which prefixes its model ids; Azure's is `azure`. */
export const OPENCODE_PROVIDER_ID = 'nuphos-custom'
export const opencodeModel = (provider: CustomProvider, id: string) =>
  `${provider.type === 'azure' ? 'azure' : OPENCODE_PROVIDER_ID}/${id}`

const FILE = 'custom-providers.json'
const MAX_MODELS = 50
const MODEL_ID = /^[\w.:/@[\]-]{1,200}$/u
const KEY = /^\S{1,4096}$/u
const AZURE = /^https:\/\/[a-z0-9][a-z0-9-]{1,62}\.openai\.azure\.com$/iu
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

export const isAgent = (provider: unknown): provider is CustomProviderAgent =>
  provider === 'claude-code' || provider === 'codex' || provider === 'opencode'

/**
 * The key's item, named after the directory the provider is saved in: `users/<userId>`, or
 * `instances/<id>/users/<userId>` for an added agent. Only OpenCode keeps one per runtime;
 * the others, one per account.
 */
export function providerAccount(userDir: string, provider: CustomProviderAgent): string {
  const userId = path.basename(userDir)

  if (provider !== 'opencode') return `${userId}:${provider}`
  const runtime = path.dirname(path.dirname(userDir))
  const added = path.basename(path.dirname(runtime)) === 'instances'

  return `${userId}:opencode:${added ? path.basename(runtime) : 'default'}`
}

/** HTTPS, or plain HTTP to a gateway on this computer; never credentials in the URL. */
export function parseCustomProvider(
  value: unknown,
  provider?: CustomProviderAgent,
): CustomProvider {
  const { baseUrl, models, type } = (value ?? {}) as Record<string, unknown>
  const azure = provider === 'opencode' && type === 'azure'
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
  if (azure && !AZURE.test(url.origin))
    throw new Error('Enter only the resource name, such as acme-openai, not the full URL.')
  const ids = [
    ...new Set(
      (Array.isArray(models) ? models : []).map((id) => (typeof id === 'string' ? id.trim() : '')),
    ),
  ].filter(Boolean)

  if (ids.length > MAX_MODELS || ids.some((id) => !MODEL_ID.test(id)))
    throw new Error('Enter up to 50 model IDs, one per line, without spaces.')
  // OpenCode has no model of its own to fall back on.
  if (provider === 'opencode' && ids.length === 0)
    throw new Error(azure ? 'Enter at least one deployment name.' : 'Enter at least one model ID.')

  return azure
    ? { baseUrl: url.origin, models: ids, type: 'azure' }
    : { baseUrl: (baseUrl as string).trim(), models: ids }
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
          return isAgent(provider) ? [[provider, parseCustomProvider(value, provider)]] : []
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

const typedKey = (value: unknown) => {
  const raw = (value as { apiKey?: unknown }).apiKey

  return typeof raw === 'string' ? raw.trim() : ''
}

/** The typed key, or else the stored one. */
const keyFor = async (
  store: KeyStore,
  userDir: string,
  provider: CustomProviderAgent,
  value: unknown,
) => typedKey(value) || (await store.get(providerAccount(userDir, provider)).catch(() => null))

/** A gateway of OpenAI's shape on this computer may need no key at all. */
const keyOptional = (provider: CustomProviderAgent, parsed: CustomProvider) =>
  provider === 'opencode' && !parsed.type && LOOPBACK.has(new URL(parsed.baseUrl).hostname)

/** Tests a provider before it is saved, with the typed key or else the stored one. */
export async function checkCustomProvider(
  store: KeyStore,
  userDir: string,
  provider: unknown,
  value: unknown,
): Promise<CustomProviderCheck> {
  if (!isAgent(provider)) throw new Error('Unknown runtime.')
  const parsed = parseCustomProvider(value, provider)
  const key = await keyFor(store, userDir, provider, value)

  if (!key && !keyOptional(provider, parsed)) throw new Error('Enter the API key.')

  return checkWithKey(provider, parsed, key ?? '')
}

/** A refusal as the app shows it: coded, since the app shows no uncoded error. */
export const notSaved = (cause: unknown): never => {
  throw buildAtlasError(atlasErrorInfo(cause).message, 'custom_provider_not_saved')
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
  provider: unknown,
  value: unknown,
): Promise<void> {
  if (!isAgent(provider)) throw new Error('Unknown runtime.')
  if (value === null) {
    await store.delete(providerAccount(userDir, provider))
    writeCustomProvider(userDir, provider, null)

    return
  }
  const parsed = parseCustomProvider(value, provider)
  const key = typedKey(value)

  if (key && !KEY.test(key)) throw new Error('Paste the whole API key.')
  const probeKey = provider === 'codex' && (await keyFor(store, userDir, provider, value))

  // An unreachable one may be saved: the gateway may simply not be running yet.
  const check = probeKey && (await checkWithKey(provider, parsed, probeKey))

  if (check && 'failure' in check && check.failure?.reason === 'api')
    throw new Error(
      'Codex needs the OpenAI Responses API, which this URL doesn’t serve. Use the provider’s base URL, such as https://api.example.com/v1.',
    )

  if (key) {
    try {
      await store.set(providerAccount(userDir, provider), key)
    } catch {
      throw new Error(
        `This computer has no secure credential store Nuphos can use, so the key was not saved.${
          process.platform === 'linux'
            ? '\n\nOn Linux, install and unlock a Secret Service keyring (GNOME Keyring or KWallet), then try again.'
            : ''
        }`,
      )
    }
  } else if (!readCustomProviders(userDir)[provider] && !keyOptional(provider, parsed))
    throw new Error('Enter the API key.')
  writeCustomProvider(userDir, provider, parsed)
}

/**
 * The saved provider of the agent with this home, and its key; undefined without a provider.
 * Rejects when the key cannot be read, so the agent never starts without it. Given the CLI
 * that will run, Codex's catalog of the provider's models is written first.
 */
export async function customProviderLaunch(
  store: KeyStore,
  provider: LocalAgentProvider,
  agentHome: string,
  run?: { cliPath: string; env: NodeJS.ProcessEnv },
): Promise<CustomProviderLaunch | undefined> {
  // A home sits in its account's directory, `users/<userId>`, beside the saved providers.
  const dir = path.dirname(agentHome)
  const saved = isAgent(provider) ? readCustomProviders(dir)[provider] : undefined

  if (!saved || !isAgent(provider)) return
  const key = await store.get(providerAccount(dir, provider))

  if (!key && !keyOptional(provider, saved))
    throw new Error('The custom provider’s API key is missing. Enter it again.')
  if (run && provider === 'codex') await prepareCodexCatalog(agentHome, run.cliPath, run.env, saved)

  return {
    // OpenCode names a model by its provider too, as its config does (custom-provider-opencode.ts).
    models:
      provider === 'opencode' ? saved.models.map((id) => opencodeModel(saved, id)) : saved.models,
    env: key ? { [PROVIDER_KEY_ENV[provider]]: key } : {},
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
