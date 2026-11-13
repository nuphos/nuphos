import type { RuntimeLoginDoc } from './runtime-login-store'

/** Claude's own authorize page, and nothing a runtime could substitute for it. */
export function isClaudeAuthorizeUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4096) return false
  try {
    const url = new URL(value)

    return (
      url.protocol === 'https:' &&
      ['claude.com', 'claude.ai'].includes(url.hostname) &&
      url.pathname.endsWith('/oauth/authorize')
    )
  } catch {
    return false
  }
}

/** Google's authorize page, as Antigravity's sign-in opens it. */
export function isGoogleAuthorizeUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4096) return false
  try {
    const url = new URL(value)

    return (
      url.protocol === 'https:' &&
      url.hostname === 'accounts.google.com' &&
      ['/o/oauth2/auth', '/o/oauth2/v2/auth'].includes(url.pathname) &&
      !url.username &&
      !url.password &&
      !url.port
    )
  } catch {
    return false
  }
}

/**
 * One step of a sign-in that asks before it authorizes (OpenCode): pick a provider,
 * method or option; type a field or an API key; or approve on a page, which may hand
 * back a code or end on a loopback address the user pastes.
 */
export type RuntimeLoginStep =
  | { kind: 'choose'; message: string; options: { value: string; label: string; hint?: string }[] }
  | { kind: 'input'; message: string; placeholder?: string; secret?: boolean }
  | { kind: 'browser'; url: string; instructions?: string; paste?: 'code' | 'address' }

/** What a runtime's sign-in reports, once the private stream is checked. */
export type RuntimeLoginFrame =
  | { type: 'device'; verificationUri: string; userCode: string }
  | { type: 'authorize'; url: string }
  | { type: 'step'; step: RuntimeLoginStep }
  | { type: 'authenticated' }
  /** The runtime removed the API key it was signed in with. */
  | { type: 'signedOut' }
  | { type: 'error'; message: string }

const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max
const optionalText = (value: unknown, max: number) => value === undefined || text(value, max)

/** An https page with a host and no credentials in it: what a client may offer to open. */
function pageUrl(value: unknown): value is string {
  if (!text(value, 4096)) return false
  try {
    const url = new URL(value)

    return url.protocol === 'https:' && url.hostname !== '' && !url.username && !url.password
  } catch {
    return false
  }
}

/** A step frame, bounded field by field; anything else is not a step. */
export function parseLoginStep(frame: Record<string, unknown>): RuntimeLoginStep | undefined {
  if (frame.type === 'choose' && text(frame.message, 500) && Array.isArray(frame.options)) {
    const options = frame.options as Record<string, unknown>[]

    if (
      options.length === 0 ||
      options.length > 1000 ||
      !options.every(
        (option) =>
          text(option.value, 200) && text(option.label, 200) && optionalText(option.hint, 200),
      )
    )
      return undefined

    return {
      kind: 'choose',
      message: frame.message,
      options: options.map(({ value, label, hint }) => ({
        value: value as string,
        label: label as string,
        ...(hint ? { hint: hint as string } : {}),
      })),
    }
  }
  if (
    frame.type === 'input' &&
    text(frame.message, 500) &&
    optionalText(frame.placeholder, 200) &&
    (frame.secret === undefined || typeof frame.secret === 'boolean')
  )
    return {
      kind: 'input',
      message: frame.message,
      ...(frame.placeholder ? { placeholder: frame.placeholder as string } : {}),
      ...(frame.secret ? { secret: true } : {}),
    }
  if (
    frame.type === 'browser' &&
    // Empty when the method has no page, such as a CLI sign-in on the runtime's host.
    (frame.url === '' || pageUrl(frame.url)) &&
    (frame.instructions === undefined ||
      (typeof frame.instructions === 'string' && frame.instructions.length <= 1000)) &&
    (frame.paste === undefined || frame.paste === 'code' || frame.paste === 'address')
  )
    return {
      kind: 'browser',
      url: frame.url as string,
      ...(frame.instructions ? { instructions: frame.instructions as string } : {}),
      ...(frame.paste ? { paste: frame.paste as 'code' | 'address' } : {}),
    }

  return undefined
}

/**
 * The `code#state` Claude's callback page shows, or the loopback address Google's
 * sign-in leaves the browser on for Antigravity. The runtime checks the port itself.
 */
export const AUTHORIZATION_CODE =
  /^(?:[\w.~-]{1,2048}#[\w.~-]{1,512}|http:\/\/(?:127\.0\.0\.1|localhost):\d{1,5}\/\?[\w.~%&=/+:-]{1,4096})$/u
/** In place of the account sign-in: an API key for the runtime's CLI, or removing it. */
export const API_KEY_ANSWER = /^(?:sk-[\w-]{20,400}|sign-out)$/u
const LOOPBACK_ADDRESS = /^http:\/\/(?:127\.0\.0\.1|localhost):\d{1,5}\/\S*$/u

/** Whether `answer` is what the sign-in is waiting for; the runtime checks it again. */
export function acceptsAnswer(doc: RuntimeLoginDoc, answer: string): boolean {
  const { step } = doc

  if (!step) return AUTHORIZATION_CODE.test(answer) || API_KEY_ANSWER.test(answer)
  if (step.kind === 'choose') return step.options.some((option) => option.value === answer)
  if (step.kind === 'browser' && step.paste === 'address') return LOOPBACK_ADDRESS.test(answer)

  return answer.length > 0
}
