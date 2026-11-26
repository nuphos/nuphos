import type { AgentProvider, RuntimeLoginStep } from '../../types/runtime.ts'

/** The pages each agent's sign-in may send the user to, and nothing a runtime could substitute. */
const AUTHORIZE_PAGES: Partial<Record<AgentProvider, (url: URL) => boolean>> = {
  'claude-code': (url) => ['claude.com', 'claude.ai'].includes(url.hostname),
  antigravity: (url) =>
    url.hostname === 'accounts.google.com' &&
    ['/o/oauth2/auth', '/o/oauth2/v2/auth'].includes(url.pathname),
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

    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      AUTHORIZE_PAGES[provider]?.(url)
      ? url.href
      : undefined
  } catch {
    return undefined
  }
}

/** The page to enter a one-time code on, when it is the one this agent uses. */
export function devicePage(provider: AgentProvider, uri: string | undefined): string | undefined {
  return uri && DEVICE_PAGES[provider] === uri ? uri : undefined
}

/**
 * Whether the pasted text can finish sign-in: a CLI code or callback URL.
 * Older Antigravity images still require the loopback address.
 */
export function pastedSignInReady(provider: AgentProvider, text: string): boolean {
  const value = text.trim()

  if (provider !== 'antigravity') return value.length > 0
  // Current CLI accepts a code; older runtime images still accept a loopback URL.
  if (/^[A-Za-z0-9._~/-]{1,4096}$/u.test(value)) return true
  try {
    const url = new URL(value)

    return (
      ((url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)) ||
        (url.protocol === 'https:' &&
          url.hostname === 'antigravity.google' &&
          url.pathname === '/oauth-callback')) &&
      !url.username &&
      !url.password &&
      (url.searchParams.has('code') || url.searchParams.has('error'))
    )
  } catch {
    return false
  }
}

/** What is left of a sign-in that ends at `expiresAt`, as "m:ss"; null once it has ended. */
export function timeLeft(expiresAt: string, now: number): string | null {
  const seconds = Math.ceil((Date.parse(expiresAt) - now) / 1000)

  if (Number.isNaN(seconds) || seconds <= 0) return null

  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`
}

/** A question the sign-in already asked, and how it was answered. */
export type Answered = { question: string; answer: string }

/** How an answer reads back: a picked option's name, and never a secret. */
export function answered(step: RuntimeLoginStep, answer: string): Answered | null {
  if (step.kind === 'browser') return null
  if (step.kind === 'input')
    return { question: step.message, answer: step.secret ? '••••' : answer }
  const option = step.options.find((candidate) => candidate.value === answer)

  return { question: step.message, answer: option?.label ?? answer }
}
