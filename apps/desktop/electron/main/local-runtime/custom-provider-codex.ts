// Codex's own entry for a custom provider in its config.toml, kept in step with the saved one.

import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import type { CustomProvider } from './custom-provider.ts'

const BEGIN = '# Nuphos custom provider (begin)'
const END = '# Nuphos custom provider (end)'
const CODEX_PROVIDER_ID = 'nuphos-custom'

/** The variable Codex's provider names as its `env_key`, which holds the key. */
export const CODEX_KEY_ENV = 'NUPHOS_CODEX_PROVIDER_KEY'
/** The custom provider's models as Codex's own catalog, beside config.toml. */
const CATALOG = 'nuphos-models.json'

/**
 * Codex's own `model_providers` entry, as root keys at the top of its config.toml: an inline
 * table needs no table header, so the block is one span that is easy to replace.
 */
export function codexProviderConfig(
  contents: string,
  provider: CustomProvider | undefined,
  catalog?: string,
) {
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
    `env_key = ${JSON.stringify(CODEX_KEY_ENV)}`,
  ].join(', ')

  return [
    BEGIN,
    `model_provider = ${JSON.stringify(CODEX_PROVIDER_ID)}`,
    ...(provider.models[0] ? [`model = ${JSON.stringify(provider.models[0])}`] : []),
    ...(catalog ? [`model_catalog_json = ${JSON.stringify(catalog)}`] : []),
    `model_providers.${CODEX_PROVIDER_ID} = { ${table} }`,
    END,
    rest,
  ].join('\n')
}

/** Brings a Codex home's config.toml in line with this provider, or with none. */
export function applyCodexProvider(config: string, provider: CustomProvider | undefined): void {
  const current = existsSync(config) ? readFileSync(config, 'utf8') : ''
  const catalog = path.join(path.dirname(config), CATALOG)
  const next = codexProviderConfig(
    current,
    provider,
    provider && provider.models.length > 1 && existsSync(catalog) ? catalog : undefined,
  )

  if (next !== current) writeFileSync(config, next, { mode: 0o600 })
}

/**
 * Codex's catalog with one entry per custom model ID, each a copy of the first API model the
 * CLI itself lists, so the entry has the fields this CLI version needs. Codex's adapter offers
 * and accepts only catalog models, so without it only the configured `model` is usable (#5214).
 * Undefined when the CLI cannot print its catalog, as one too old for `codex debug models`.
 */
export async function codexModelCatalog(
  cliPath: string,
  env: NodeJS.ProcessEnv,
  models: string[],
): Promise<string | undefined> {
  // A home of its own, so the catalog is the CLI's own and not one written here before.
  const home = mkdtempSync(path.join(tmpdir(), 'nuphos-codex-models-'))

  try {
    const { stdout } = await promisify(execFile)(cliPath, ['debug', 'models'], {
      env: { ...env, CODEX_HOME: home },
      timeout: 15_000,
      maxBuffer: 64 * 1024 * 1024,
    })
    const listed = (JSON.parse(stdout) as { models?: Record<string, unknown>[] }).models ?? []
    const base = listed.find((model) => model.supported_in_api !== false) ?? listed.at(0)

    if (!base) return

    return JSON.stringify({
      models: models.map((slug, priority) => ({
        ...base,
        slug,
        display_name: slug,
        description: 'Custom provider',
        visibility: 'list',
        priority,
        upgrade: null,
        availability_nux: null,
        service_tiers: [],
        additional_speed_tiers: [],
      })),
    })
  } catch {
    return
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

/**
 * Before Codex starts with a custom provider of several models: writes their catalog beside
 * config.toml and names it there, or removes it when it is not needed or cannot be made, so
 * Codex then runs the first model alone.
 */
export async function prepareCodexCatalog(
  agentHome: string,
  cliPath: string,
  env: NodeJS.ProcessEnv,
  provider: CustomProvider,
): Promise<void> {
  const file = path.join(agentHome, CATALOG)
  const catalog =
    provider.models.length > 1 ? await codexModelCatalog(cliPath, env, provider.models) : undefined

  if (catalog) writeFileSync(file, catalog, { mode: 0o600 })
  else rmSync(file, { force: true })
  applyCodexProvider(path.join(agentHome, 'config.toml'), provider)
}
