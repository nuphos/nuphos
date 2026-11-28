// OpenCode's own entry for a custom provider in its opencode.json, kept in step with the saved
// one. The key stays out of the file: OpenCode reads it from the variable the launch sets.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  OPENCODE_PROVIDER_ID,
  PROVIDER_KEY_ENV,
  opencodeModel,
  readCustomProviders,
} from './custom-provider.ts'

import type { CustomProvider } from './custom-provider.ts'

type Config = { provider?: Record<string, unknown>; model?: unknown; [key: string]: unknown }

const API_KEY = `{env:${PROVIDER_KEY_ENV.opencode}}`

/** Ours: an `azure` entry is, only when it reads its key from our variable. */
const ours = (config: Config, id: string) =>
  id === OPENCODE_PROVIDER_ID ||
  (config.provider?.[id] as { options?: { apiKey?: unknown } } | undefined)?.options?.apiKey ===
    API_KEY

/** The config with the given provider in place of the one Nuphos wrote before, if any. */
export function opencodeProviderConfig(config: Config, provider: CustomProvider | undefined) {
  const { [OPENCODE_PROVIDER_ID]: _custom, ...providers } = config.provider ?? {}

  if (ours(config, 'azure')) delete providers.azure
  const next: Config = { ...config, provider: providers }
  const model = typeof config.model === 'string' ? config.model.split('/')[0] : ''

  if (model && ours(config, model)) delete next.model
  if (provider) {
    const id = provider.type === 'azure' ? 'azure' : OPENCODE_PROVIDER_ID
    const options =
      provider.type === 'azure'
        ? { resourceName: new URL(provider.baseUrl).hostname.split('.')[0], apiKey: API_KEY }
        : { baseURL: provider.baseUrl, apiKey: API_KEY }

    providers[id] = {
      ...(id === OPENCODE_PROVIDER_ID
        ? { npm: '@ai-sdk/openai-compatible', name: 'Custom provider' }
        : {}),
      options,
      models: Object.fromEntries(provider.models.map((model) => [model, { name: model }])),
    }
    next.model = opencodeModel(provider, provider.models[0])
  }
  if (Object.keys(providers).length === 0) delete next.provider

  return next
}

/** Brings an OpenCode home's opencode.json in line with the provider saved beside it. */
export function applyOpenCodeProvider(userDir: string, home: string): void {
  const file = path.join(home, '.config', 'opencode', 'opencode.json')
  let current: Config | undefined

  try {
    current = JSON.parse(readFileSync(file, 'utf8')) as Config
  } catch {
    current = undefined
  }
  const provider = readCustomProviders(userDir).opencode

  if (!current && !provider) return
  const next = opencodeProviderConfig(current ?? {}, provider)

  if (JSON.stringify(next) === JSON.stringify(current)) return
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
}
