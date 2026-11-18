import { isClaudeAuthorizeUrl, isGoogleAuthorizeUrl, parseLoginStep } from './runtime-login-step'

import type { RuntimeLoginFrame } from './runtime-login-step'

const LOGIN_ERRORS = new Map<unknown, string>([
  [
    'input_unavailable',
    'This agent cannot receive the sign-in code. Update its image, or run `claude auth login` inside the container.',
  ],
  ['failed', 'Sign-in did not complete. Start again and paste the whole code Claude shows you.'],
  [
    'environment',
    'Hermes could not prepare its environment on this computer. Check that the computer is online, then start again.',
  ],
])

/** The device pages a runtime may send a user to: ChatGPT for Codex, xAI for Grok Build. */
const DEVICE_VERIFICATION_URIS = new Set([
  'https://auth.openai.com/codex/device',
  'https://accounts.x.ai/oauth2/device',
])

/**
 * Bounded private stream parser; unknown or malformed frames never reach the UI.
 *
 * The runtime keeps the credential it signs in with, so an `authenticated` frame that
 * offers one anyway is a runtime handing over what nobody asked it for.
 */
export function loginFrameReader(
  onFrame: (frame: RuntimeLoginFrame) => void,
  // The provider's own advice when its sign-in fails.
  failed = LOGIN_ERRORS.get('failed'),
  // Whether this runtime may ask the user in steps (OpenCode, DeepSeek Harness).
  steps = false,
) {
  let pending = ''

  return (chunk: string) => {
    pending += chunk
    if (pending.length > 128 * 1024) throw new Error('Invalid login response')
    let newline: number

    while ((newline = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, newline)

      pending = pending.slice(newline + 1)
      if (!line.trim()) continue
      const frame = JSON.parse(line) as Record<string, unknown>
      const step = steps ? parseLoginStep(frame) : undefined

      if (step) onFrame({ type: 'step', step })
      else if (
        frame.type === 'device' &&
        DEVICE_VERIFICATION_URIS.has(frame.verificationUri as string) &&
        typeof frame.userCode === 'string' &&
        /^[A-Za-z0-9-]{4,32}$/u.test(frame.userCode)
      ) {
        onFrame({
          type: 'device',
          verificationUri: frame.verificationUri as string,
          userCode: frame.userCode,
        })
      } else if (
        frame.type === 'authorize' &&
        (isClaudeAuthorizeUrl(frame.url) || isGoogleAuthorizeUrl(frame.url))
      ) {
        onFrame({ type: 'authorize', url: frame.url })
      } else if (frame.type === 'authenticated' && frame.authJson === undefined) {
        onFrame({ type: 'authenticated' })
      } else if (frame.type === 'signedOut') {
        onFrame({ type: 'signedOut' })
      } else if (frame.type === 'error') {
        onFrame({
          type: 'error',
          message:
            (frame.reason === 'failed' ? failed : LOGIN_ERRORS.get(frame.reason)) ??
            'Sign-in did not complete. Retry and check device-code login in ChatGPT security settings.',
        })
      } else throw new Error('Invalid login response')
    }
  }
}
