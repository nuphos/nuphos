// `nuphos agent`'s model provider: the operator's own environment variables, the ones each CLI
// already reads, passed on only when set. The values go into openab's environment and reach the
// agent by name (`inherit_env`), as a saved custom provider's key does, so no file or log Nuphos
// writes holds them. Desktop never reads these from a person's shell, which may hold keys meant
// for something else; it has its own custom provider setting.

import path from 'node:path'

import { applyCodexProvider } from './custom-provider-codex.ts'
import { PROVIDER_KEY_ENV } from './custom-provider.ts'

import type { LocalRuntimeControllerDeps } from './controller-types.ts'
import type { LocalAgentProvider } from './providers.ts'

/** Claude Code's own variables: an Anthropic-compatible gateway, Bedrock, Vertex AI or Foundry. */
export const CLAUDE_PROVIDER_ENV = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'CLAUDE_CODE_USE_BEDROCK',
  'AWS_REGION',
  'AWS_PROFILE',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'ANTHROPIC_VERTEX_PROJECT_ID',
  'CLOUD_ML_REGION',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'CLAUDE_CODE_USE_FOUNDRY',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'ANTHROPIC_FOUNDRY_RESOURCE',
  'ANTHROPIC_FOUNDRY_BASE_URL',
] as const

/**
 * Codex's: an OpenAI-compatible endpoint (Azure OpenAI's `/openai/v1` among them) and its key.
 * Codex reads no endpoint from its environment, so it gets the same `config.toml` provider entry
 * as Desktop's custom provider, whose key is `PROVIDER_KEY_ENV.codex`.
 */
export const CODEX_PROVIDER_ENV = ['OPENAI_BASE_URL', 'OPENAI_API_KEY'] as const

const OPENAI_API = 'https://api.openai.com/v1'
const set = (env: NodeJS.ProcessEnv, key: string) => env[key]?.trim() || undefined
const host = (url: string | undefined) => (url ? new URL(url).host : undefined)

/** The variables this agent gets from the host; empty when none is set. */
export function hostProviderEnv(
  provider: LocalAgentProvider,
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  if (provider === 'codex') {
    const key = set(env, 'OPENAI_API_KEY')

    return key ? { [PROVIDER_KEY_ENV.codex]: key } : {}
  }
  if (provider !== 'claude-code') return {}

  return Object.fromEntries(
    CLAUDE_PROVIDER_ENV.flatMap((name) => {
      const value = set(env, name)

      return value ? [[name, value]] : []
    }),
  )
}

/** Where the agent's requests go, shown in place of its sign-in; undefined without a provider. */
export function hostProviderName(
  provider: LocalAgentProvider,
  env: NodeJS.ProcessEnv,
): string | undefined {
  try {
    if (provider === 'codex')
      return set(env, 'OPENAI_API_KEY') && host(set(env, 'OPENAI_BASE_URL') ?? OPENAI_API)
    if (provider !== 'claude-code') return
    if (set(env, 'CLAUDE_CODE_USE_BEDROCK')) return 'Amazon Bedrock'
    if (set(env, 'CLAUDE_CODE_USE_VERTEX')) return 'Google Vertex AI'
    if (set(env, 'CLAUDE_CODE_USE_FOUNDRY')) return 'Microsoft Foundry'
    if (set(env, 'ANTHROPIC_AUTH_TOKEN') || set(env, 'ANTHROPIC_API_KEY'))
      return host(set(env, 'ANTHROPIC_BASE_URL')) ?? 'Anthropic API'
  } catch {
    // A base URL that is not a URL: no provider, so the agent keeps its own sign-in.
  }
}

/** One line for the terminal: which agents use the host's provider, by variable name only. */
function summary(env: NodeJS.ProcessEnv): string | undefined {
  const lines = (['claude-code', 'codex'] as const).flatMap((provider) => {
    const name = hostProviderName(provider, env)
    const names = (provider === 'codex' ? CODEX_PROVIDER_ENV : CLAUDE_PROVIDER_ENV).filter((key) =>
      set(env, key),
    )

    return name ? [`  ${provider}: ${name} (${names.join(', ')})`] : []
  })

  return lines.length
    ? `Model provider from this computer's environment:\n${lines.join('\n')}`
    : undefined
}

/**
 * The host's agents with its provider: its variables reach openab by name, it stands in for the
 * sign-in, and a Codex home carries its endpoint. Unchanged without provider variables.
 */
export function withHostProvider(
  env: NodeJS.ProcessEnv,
  deps: LocalRuntimeControllerDeps,
  print: (line: string) => void = console.log,
): LocalRuntimeControllerDeps {
  const line = summary(env)

  if (!line) return deps
  print(line)
  // An agent signed in with a token shared through the Vault uses that token alone.
  const own = (provider: LocalAgentProvider, runtimeEnv: NodeJS.ProcessEnv) =>
    runtimeEnv.NUPHOS_VAULT_SOCKET ? undefined : hostProviderName(provider, env)

  return {
    ...deps,
    probeCli: async (provider, runtimeEnv, agentHome) => {
      const cli = await deps.probeCli(provider, runtimeEnv, agentHome)
      const name = own(provider, runtimeEnv)

      return name && cli.installed ? { ...cli, loggedIn: true, customProvider: name } : cli
    },
    prepareAgentHome: (provider, userDir, workspace, runtimeEnv) => {
      const home = deps.prepareAgentHome(provider, userDir, workspace, runtimeEnv)

      if (provider === 'codex' && home && hostProviderName('codex', env))
        applyCodexProvider(userDir, path.join(home, 'config.toml'), {
          baseUrl: set(env, 'OPENAI_BASE_URL') ?? OPENAI_API,
          models: [],
        })

      return home
    },
    createProcess: () => {
      const process = deps.createProcess()

      return {
        start: (options) => {
          if (!own(options.provider, options.env)) return process.start(options)

          return process.start({
            ...options,
            secretEnv: { ...hostProviderEnv(options.provider, env), ...options.secretEnv },
          })
        },
        stop: () => process.stop(),
        onExit: (listener) => process.onExit(listener),
      }
    },
  }
}
