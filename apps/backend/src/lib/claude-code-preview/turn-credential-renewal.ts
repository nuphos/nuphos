import { logError } from '@/lib/observability'

import { OpenAbRpcError } from './openab-acp-errors'

type Env = Record<string, string> | undefined

const RENEW_INTERVAL_MS = 10 * 60 * 1000
// OpenAB's refusal when the session does not hold `expected` (`SessionPool::refresh_session_credentials`).
const CREDENTIALS_CHANGED = 'Session credentials changed since this refresh'

/** A push that failed before it reached the runtime, so the runtime changed nothing. */
export class UndeliveredCredentialPush extends Error {
  constructor(cause: unknown) {
    super('Credential push did not reach the runtime', { cause })
    this.name = 'UndeliveredCredentialPush'
  }
}

/**
 * Keeps a running turn's credentials current. Each push names the credentials
 * it replaces, and the runtime applies it only while they are still installed,
 * so a late push never overwrites a later prompt's. A push whose reply is lost
 * may still have been applied, so later pushes also try it as `expected` until
 * the runtime rules it out. Pushes run one at a time, and stop for good once
 * the runtime says it cannot take them.
 */
export function renewTurnCredentials(args: {
  installed: Env
  mint: () => Env | Promise<Env>
  /**
   * Resolves `false` when the runtime cannot take credentials mid-turn. Rejects
   * with `OpenAbRpcError` when the runtime refused it, and with
   * `UndeliveredCredentialPush` when it never reached the runtime; any other
   * failure leaves it unknown whether the runtime applied it.
   */
  push: (expected: Env, next: Env) => Promise<boolean>
  intervalMs?: number
}) {
  let installed = args.installed
  // Pushes that failed without a reply: the runtime may hold any of them.
  let unconfirmed: Env[] = []
  let stopped = false
  // Read through a call: a push awaits, and `stop` may run meanwhile.
  const isStopped = () => stopped
  let queue: Promise<void> = Promise.resolve()
  const stop = () => {
    stopped = true
    clearInterval(timer)
  }
  // Tries each set the runtime may hold as `expected`; the runtime applies at most one.
  const renew = async () => {
    if (isStopped()) return
    const next = await args.mint()
    let failure: unknown

    for (const expected of [installed, ...unconfirmed]) {
      if (isStopped()) return
      try {
        if (!(await args.push(expected, next))) {
          stop()

          return
        }
        installed = next
        unconfirmed = []

        return
      } catch (error) {
        failure = error
        if (error instanceof OpenAbRpcError) {
          // Only a mismatch rules `expected` out. Any other refusal (a failed
          // credential write) also applied nothing, but `expected` may be held.
          if (error.message !== CREDENTIALS_CHANGED) break
          unconfirmed = unconfirmed.filter((candidate) => candidate !== expected)
          continue
        }
        // Without an answer `next` may now be installed; undelivered, nothing changed.
        if (!(error instanceof UndeliveredCredentialPush)) unconfirmed = [...unconfirmed, next]
        break
      }
    }
    throw failure
  }
  const timer = setInterval(() => {
    queue = queue.then(renew).catch((error: unknown) => {
      logError('preview.credentials.renew_failed', error)
    })
  }, args.intervalMs ?? RENEW_INTERVAL_MS)

  return {
    stop,
    /** Resolves once the push in flight, if any, has settled. */
    settled: () => queue,
  }
}
