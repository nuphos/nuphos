import { logError } from '@/lib/observability'

type Env = Record<string, string> | undefined

// Renewed every 10 minutes, so two missed renewals still leave time to recover.
export const RENEWED_TOKEN_TTL_SEC = 30 * 60
const RENEW_INTERVAL_MS = 10 * 60 * 1000
// A turn handed to another replica is no longer renewed; it keeps the default.
const HANDED_OFF_TOKEN_TTL_SEC = 24 * 60 * 60

/**
 * Keeps a running turn's short-lived credentials current. Each push names the
 * credentials it replaces, and the runtime applies it only while they are
 * still installed, so a late push never overwrites a later prompt's. Pushes
 * run one at a time.
 */
export function renewTurnCredentials(args: {
  installed: Env
  renew: (ttlSec: number) => { runtimeEnv?: Record<string, string> }
  refresh: (expected: Env, next: Env) => Promise<unknown>
  intervalMs?: number
}) {
  let installed = args.installed
  let queue: Promise<void> = Promise.resolve()
  const push = (ttlSec: number) => {
    queue = queue
      .then(async () => {
        const next = args.renew(ttlSec).runtimeEnv

        await args.refresh(installed, next)
        installed = next
      })
      .catch((error: unknown) => {
        logError('preview.credentials.renew_failed', error)
      })

    return queue
  }
  const timer = setInterval(
    () => void push(RENEWED_TOKEN_TTL_SEC),
    args.intervalMs ?? RENEW_INTERVAL_MS,
  )

  return {
    stop: () => {
      clearInterval(timer)
    },
    /** Before another replica takes the turn over, leave it a long-lived token. */
    handOff: () => {
      clearInterval(timer)

      return push(HANDED_OFF_TOKEN_TTL_SEC)
    },
  }
}
