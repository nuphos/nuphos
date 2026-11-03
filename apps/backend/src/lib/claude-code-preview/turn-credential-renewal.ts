import { logError } from '@/lib/observability'

type Env = Record<string, string> | undefined

const RENEW_INTERVAL_MS = 10 * 60 * 1000
// Older unconfirmed pushes are dropped; by then their tokens have expired anyway.
const MAX_UNCONFIRMED = 3

/**
 * Keeps a running turn's credentials current. Each push names the credentials
 * it replaces, and the runtime applies it only while they are still installed,
 * so a late push never overwrites a later prompt's. A push whose reply is lost
 * may still have been applied, so later pushes also try it as `expected`.
 * Pushes run one at a time, and stop for good once the runtime says it cannot
 * take them.
 */
export function renewTurnCredentials(args: {
  installed: Env
  mint: () => Env | Promise<Env>
  /** Resolves `false` when the runtime cannot take credentials mid-turn. */
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
      }
    }
    unconfirmed = [...unconfirmed, next].slice(-MAX_UNCONFIRMED)
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
