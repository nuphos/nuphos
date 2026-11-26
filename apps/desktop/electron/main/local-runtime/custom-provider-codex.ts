// Codex's own entry for a custom provider in its config.toml, kept in step with the saved one.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'

import { PROVIDER_KEY_ENV, readCustomProviders } from './custom-provider.ts'

import type { CustomProvider } from './custom-provider.ts'

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

/** Brings a Codex home's config.toml in line with the provider saved beside it, or the one given. */
export function applyCodexProvider(
  userDir: string,
  config: string,
  provider = readCustomProviders(userDir).codex,
): void {
  const current = existsSync(config) ? readFileSync(config, 'utf8') : ''
  const next = codexProviderConfig(current, provider)

  if (next !== current) writeFileSync(config, next, { mode: 0o600 })
}
