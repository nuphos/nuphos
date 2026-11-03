import { logError } from '@/lib/observability'

type Env = Record<string, string> | undefined

const RENEW_INTERVAL_MS = 10 * 60 * 1000

/**
 * Keeps a running turn's credentials current. Each push names the credentials
 * it replaces, and the runtime applies it only while they are still installed,
 * so a late push never overwrites a later prompt's. Pushes run one at a time,
 * and stop for good once the runtime says it cannot take them.
 */
export function renewTurnCredentials(args: {
  installed: Env
  mint: () => Env | Promise<Env>
  /** Resolves `false` when the runtime cannot take credentials mid-turn. */
  push: (expected: Env, next: Env) => Promise<boolean>
  intervalMs?: number
}) {
  let installed = args.installed
  let stopped = false
  // Read through a call: a push awaits, and `stop` may run meanwhile.
  const isStopped = () => stopped
  let queue: Promise<void> = Promise.resolve()
  const stop = () => {
    stopped = true
    clearInterval(timer)
  }
  const renew = async () => {
    if (isStopped()) return
    const expected = installed
    const next = await args.mint()

    if (isStopped()) return
    if (await args.push(expected, next)) installed = next
    else stop()
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
