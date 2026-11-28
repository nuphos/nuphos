// A model provider of the user's own (a gateway, a proxy, another vendor's compatible API) for
// this computer's Claude Code and Codex, wired the way each CLI already supports one. The base
// URL and model ids are kept in a file; the key only in the OS credential store, and it reaches
// the agent only through process environments, never a file Nuphos writes.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { atlasErrorInfo, buildAtlasError } from '../../atlas/error.ts'

import { CODEX_KEY_ENV, prepareCodexCatalog } from './custom-provider-codex.ts'
import { checkWithKey } from './custom-provider-probe.ts'

import type { LocalRuntimeControllerDeps, RuntimeProcess } from './controller-types.ts'
import type { CustomProviderCheck } from './custom-provider-probe.ts'
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
  codex: CODEX_KEY_ENV,
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

const typedKey = (value: unknown) => {
  const raw = (value as { apiKey?: unknown }).apiKey

  return typeof raw === 'string' ? raw.trim() : ''
}

/** The typed key, or else the stored one. */
const keyFor = async (
  store: KeyStore,
  userId: string,
  provider: CustomProviderAgent,
  value: unknown,
) => typedKey(value) || (await store.get(account(userId, provider)).catch(() => null))

/** Tests a provider before it is saved, with the typed key or else the stored one. */
export async function checkCustomProvider(
  store: KeyStore,
  userId: string,
  provider: unknown,
  value: unknown,
): Promise<CustomProviderCheck> {
  if (!isAgent(provider)) throw new Error('Unknown runtime.')
  const parsed = parseCustomProvider(value)
  const key = await keyFor(store, userId, provider, value)

  if (!key) throw new Error('Enter the API key.')

  return checkWithKey(provider, parsed, key)
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
  const key = typedKey(value)

  if (key && !KEY.test(key)) throw new Error('Paste the whole API key.')
  const probeKey = provider === 'codex' && (await keyFor(store, userId, provider, value))

  // An unreachable one may be saved: the gateway may simply not be running yet.
  const check = probeKey && (await checkWithKey(provider, parsed, probeKey))

  if (check && 'failure' in check && check.failure?.reason === 'api')
    throw new Error(
      'Codex needs the OpenAI Responses API, which this URL doesn’t serve. Use the provider’s base URL, such as https://api.example.com/v1.',
    )

  if (key) {
    try {
      await store.set(account(userId, provider), key)
    } catch {
      throw new Error(
        `This computer has no secure credential store Nuphos can use, so the key was not saved.${
          process.platform === 'linux'
            ? '\n\nOn Linux, install and unlock a Secret Service keyring (GNOME Keyring or KWallet), then try again.'
            : ''
        }`,
      )
    }
  } else if (!readCustomProviders(userDir)[provider]) throw new Error('Enter the API key.')
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
  const key = await store.get(account(path.basename(dir), provider))

  if (!key) throw new Error('The custom provider’s API key is missing. Enter it again.')
  if (run && provider === 'codex') await prepareCodexCatalog(agentHome, run.cliPath, run.env, saved)

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
      const custom = await customProviderLaunch(store, options.provider, options.agentHome, options)

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
