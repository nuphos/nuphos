// Keeps a desktop view connected. Nothing short-lived is held between attempts:
// every connect, the first and each reconnect, starts by asking the backend for
// the link afresh (`mint`), so an expired link is never retried. A dropped
// connection reconnects with backoff; only the backend refusing the desktop
// (no access, the Box offline) stops the loop, and so does a desktop that
// cannot be reached at all after a few tries, so a refusal the transport
// cannot name still ends rather than spins.

export type DesktopStop = 'denied' | 'offline' | 'unreachable'

export type DesktopPhase =
  | { kind: 'connecting' }
  | { kind: 'connected' }
  | { kind: 'reconnecting' }
  | { kind: 'stopped'; reason: DesktopStop; message: string }

/** Thrown by `mint` when the backend refuses the desktop: retrying would not help. */
export class DesktopRefusal extends Error {
  readonly reason: Exclude<DesktopStop, 'unreachable'>
  constructor(reason: Exclude<DesktopStop, 'unreachable'>, message: string) {
    super(message)
    this.reason = reason
  }
}

/** Connects with a fresh link; reports the connection opening and closing, and returns how to drop it. */
export type DesktopAttach<L> = (
  link: L,
  events: { opened: () => void; closed: () => void },
) => () => void

type Timers = {
  set: (run: () => void, ms: number) => unknown
  clear: (timer: unknown) => void
  now: () => number
}

const realTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
}

/** 1 s, 2 s, 4 s … up to 15 s. */
export const reconnectDelay = (failures: number) => Math.min(15_000, 1000 * 2 ** failures)
/** A connection that lasted this long proves the desktop is reachable again. */
const STABLE_MS = 10_000
const MAX_FAILURES = 6

export function keepDesktopConnected<L>({
  mint,
  attach,
  onPhase,
  timers = realTimers,
}: {
  mint: () => Promise<L>
  attach: DesktopAttach<L>
  onPhase: (phase: DesktopPhase) => void
  timers?: Timers
}): { stop: () => void; restart: () => void } {
  let generation = 0
  let failures = 0
  let detach: (() => void) | undefined
  let timer: unknown

  const halt = () => {
    generation++
    timers.clear(timer)
    detach?.()
    detach = undefined
  }
  const retry = (run: number) => {
    if (run !== generation) return
    if (failures >= MAX_FAILURES) {
      onPhase({ kind: 'stopped', reason: 'unreachable', message: 'Could not reach the desktop.' })

      return
    }
    onPhase({ kind: 'reconnecting' })
    timer = timers.set(() => void connect(run), reconnectDelay(failures))
    failures++
  }
  const connect = async (run: number) => {
    let link: L

    try {
      link = await mint()
    } catch (error) {
      if (run !== generation) return
      if (error instanceof DesktopRefusal) {
        onPhase({ kind: 'stopped', reason: error.reason, message: error.message })

        return
      }
      retry(run)

      return
    }
    if (run !== generation) return
    let openedAt: number | undefined
    let closed = false
    let dropped = false
    const drop = () => {
      if (dropped) return
      dropped = true
      undo()
    }
    const undo = attach(link, {
      opened: () => {
        if (run !== generation || closed) return
        openedAt = timers.now()
        onPhase({ kind: 'connected' })
      },
      closed: () => {
        if (run !== generation || closed) return
        closed = true
        // Torn down off this call stack: the view may still be dispatching the close.
        queueMicrotask(drop)
        if (openedAt !== undefined && timers.now() - openedAt >= STABLE_MS) failures = 0
        retry(run)
      },
    })

    detach = drop
  }
  const restart = () => {
    halt()
    failures = 0
    onPhase({ kind: 'connecting' })
    void connect(generation)
  }

  restart()

  return { stop: halt, restart }
}
