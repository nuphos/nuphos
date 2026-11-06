import type { AgentProvider } from '../../types/runtime'

/** The runtimes whose own CLI signs in with an API key. */
export type ApiKeyProvider = 'claude-code' | 'codex'

export const API_KEY: Record<
  ApiKeyProvider,
  { vendor: string; pattern: RegExp; placeholder: string }
> = {
  codex: { vendor: 'OpenAI', pattern: /^sk-[\w-]{20,400}$/u, placeholder: 'sk-…' },
  'claude-code': {
    vendor: 'Anthropic',
    pattern: /^sk-ant-[\w-]{20,400}$/u,
    placeholder: 'sk-ant-…',
  },
}

export function signsInWithApiKey(provider: AgentProvider): provider is ApiKeyProvider {
  return provider in API_KEY
}
