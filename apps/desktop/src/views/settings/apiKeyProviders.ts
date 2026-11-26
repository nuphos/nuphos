import type { AgentProvider } from '../../types/runtime'

/** The runtimes whose own CLI signs in with an API key. */
export type ApiKeyProvider = 'claude-code' | 'codex'

export const API_KEY: Record<
  ApiKeyProvider,
  { vendor: string; pattern: RegExp; prefix: string; keys: { url: string; place: string } }
> = {
  codex: {
    vendor: 'OpenAI',
    pattern: /^sk-(?!ant-)[\w-]{20,400}$/u,
    prefix: 'sk-',
    keys: { url: 'https://platform.openai.com/api-keys', place: 'OpenAI Platform' },
  },
  'claude-code': {
    vendor: 'Anthropic',
    pattern: /^sk-ant-[\w-]{20,400}$/u,
    prefix: 'sk-ant-',
    keys: { url: 'https://console.anthropic.com/settings/keys', place: 'Anthropic Console' },
  },
}

export function signsInWithApiKey(provider: AgentProvider): provider is ApiKeyProvider {
  return provider in API_KEY
}
