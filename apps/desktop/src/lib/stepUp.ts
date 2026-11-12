import { parseAtlasError } from '../api/errors.ts'

/**
 * Step-up re-authentication. With two-factor authentication on, some actions
 * answer `403 reauth_required` (`method: mfa`) unless the session entered a code
 * in the last few minutes. Every API method is wrapped so that such a failure
 * asks for a code (the dialog registered with `onStepUp`) and, once it is
 * accepted, runs the call again. Calls that need it at the same time share one
 * prompt.
 */
type Ask = () => Promise<boolean>

let ask: Ask | null = null
let pending: Promise<boolean> | null = null

export function onStepUp(handler: Ask | null): void {
  ask = handler
}

export function needsStepUp(error: unknown): boolean {
  const { code, details } = parseAtlasError(error)

  return (
    code === 'reauth_required' && (details as { method?: unknown } | undefined)?.method === 'mfa'
  )
}

/** The challenge a sign-in answered with when the account has two-factor authentication on. */
export function mfaChallenge(error: unknown): string | null {
  const { code, details } = parseAtlasError(error)
  const token = (details as { mfaToken?: unknown } | undefined)?.mfaToken

  return code === 'mfa_required' && typeof token === 'string' ? token : null
}

function askOnce(): Promise<boolean> {
  if (!ask) return Promise.resolve(false)
  pending ??= ask().finally(() => {
    pending = null
  })

  return pending
}

export function withStepUp<T extends Record<string, unknown>>(methods: T): T {
  return Object.fromEntries(
    Object.entries(methods).map(([name, value]) => {
      if (typeof value !== 'function') return [name, value]
      const method = value as (...args: unknown[]) => unknown

      return [
        name,
        (...args: unknown[]) => {
          const result = method(...args)

          if (typeof (result as PromiseLike<unknown> | null)?.then !== 'function') return result

          return Promise.resolve(result).catch(async (error: unknown) => {
            if (!needsStepUp(error) || !(await askOnce())) throw error

            return method(...args)
          })
        },
      ]
    }),
  ) as T
}
