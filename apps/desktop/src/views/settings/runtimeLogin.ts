import type { AgentProvider } from '../../types/runtime.ts'

/** The pages each agent's sign-in may send the user to, and nothing a runtime could substitute. */
const AUTHORIZE_PAGES: Partial<Record<AgentProvider, (url: URL) => boolean>> = {
  'claude-code': (url) => ['claude.com', 'claude.ai'].includes(url.hostname),
  antigravity: (url) =>
    url.hostname === 'accounts.google.com' && url.pathname === '/o/oauth2/v2/auth',
}

const DEVICE_PAGES: Partial<Record<AgentProvider, string>> = {
  codex: 'https://auth.openai.com/codex/device',
  grok: 'https://accounts.x.ai/oauth2/device',
}

/** The browser page to open and paste back from, when this agent signs in that way. */
export function authorizeUrl(
  provider: AgentProvider,
  value: string | undefined,
): string | undefined {
  try {
    const url = new URL(value ?? '')

    return url.protocol === 'https:' && AUTHORIZE_PAGES[provider]?.(url) ? url.href : undefined
  } catch {
    return undefined
  }
}

/** The page to enter a one-time code on, when it is the one this agent uses. */
export function devicePage(provider: AgentProvider, uri: string | undefined): string | undefined {
  return uri && DEVICE_PAGES[provider] === uri ? uri : undefined
}

/**
 * Whether the pasted text can finish the sign-in. Antigravity's browser ends on a
 * 127.0.0.1 address that does not load; the whole address is what the agent needs.
 */
export function pastedSignInReady(provider: AgentProvider, text: string): boolean {
  const value = text.trim()

  if (provider !== 'antigravity') return value.length > 0
  try {
    const url = new URL(value)

    return (
      url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost'].includes(url.hostname) &&
      (url.searchParams.has('code') || url.searchParams.has('error'))
    )
  } catch {
    return false
  }
}
