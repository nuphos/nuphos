import type { SessionConfigSelection, SessionConfigState } from '../../../api/session-config-types'

type Transport = {
  read: () => Promise<SessionConfigState>
  write: (selection: SessionConfigSelection) => Promise<SessionConfigState>
}
export type ConfigSnapshot = {
  queued?: SessionConfigSelection[]
  data?: SessionConfigState
  loading: boolean
  slow: boolean
  saving: boolean
  error?: string
  /** The runtime has reported "busy" for longer than a reply reasonably
   *  takes. Distinguishes a genuinely stuck session from a normal wait, so
   *  the UI can stop implying this will resolve on its own. */
  stalled: boolean
}
const INITIAL: ConfigSnapshot = { loading: true, slow: false, saving: false, stalled: false }
// A reply legitimately keeps the session busy for a while; past this, repeated
// "busy" reads stop reading as progress and start reading as stuck.
const STALL_AFTER_MS = 45_000

/** One request at a time, independent of menu/focus changes. Never invent model values. */
export class SessionConfigSync {
  private snapshot: ConfigSnapshot = INITIAL
  private listeners = new Set<() => void>()
  private streaming = false
  private active = false
  private version = 0
  private pending = false
  private failures = 0
  private busySince?: number
  private poll?: ReturnType<typeof setTimeout>
  private slowTimer?: ReturnType<typeof setTimeout>

  private transport: Transport

  constructor(transport: Transport) {
    this.transport = transport
  }

  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)

    return () => this.listeners.delete(listener)
  }

  private publish(patch: Partial<ConfigSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }

  start() {
    this.active = true
    void this.refresh()

    return () => {
      this.active = false
      ++this.version
      this.pending = false
      clearTimeout(this.poll)
      clearTimeout(this.slowTimer)
    }
  }

  private schedule() {
    clearTimeout(this.poll)
    if (this.active)
      this.poll = setTimeout(
        () => void this.refresh(),
        Math.min(10_000 * 2 ** this.failures, 60_000),
      )
  }

  async refresh() {
    if (!this.active || this.pending || this.snapshot.saving) return
    clearTimeout(this.poll)
    this.pending = true
    const version = ++this.version

    // Background reads keep the last acknowledgement visible and do not flash a spinner.
    this.publish({ loading: !this.snapshot.data && !this.snapshot.error, slow: false })
    this.slowTimer = setTimeout(() => {
      if (this.active && version === this.version) this.publish({ slow: true })
    }, 2_000)
    try {
      const incoming = await bounded(this.transport.read(), 15_000)
      const data =
        incoming.options.length || incoming.status === 'ready' || incoming.status === 'unsupported'
          ? incoming
          : { ...incoming, options: this.snapshot.data?.options ?? [] }

      if (!this.active || version !== this.version) return
      this.failures = 0
      if (data.status === 'busy') this.busySince ??= Date.now()
      else this.busySince = undefined
      this.publish({
        data,
        loading: false,
        slow: false,
        error: undefined,
        stalled: this.busySince !== undefined && Date.now() - this.busySince >= STALL_AFTER_MS,
      })
    } catch {
      if (!this.active || version !== this.version) return
      ++this.failures
      this.busySince = undefined
      this.publish({
        loading: false,
        slow: false,
        error: 'Could not connect to the agent. Reconnecting automatically.',
        stalled: false,
      })
    } finally {
      if (this.active && version === this.version) {
        this.pending = false
        clearTimeout(this.slowTimer)
        this.schedule()
        this.applyQueued()
      }
    }
  }

  setStreaming(streaming: boolean) {
    this.streaming = streaming
    if (!streaming) void this.refresh()
  }

  private applyQueued() {
    const queued = this.snapshot.queued

    if (
      !queued ||
      this.streaming ||
      this.snapshot.saving ||
      this.snapshot.error ||
      !['ready', 'dormant'].includes(this.snapshot.data?.status ?? '')
    )
      return
    const modelId = this.snapshot.data?.options.find((option) => option.kind === 'model')?.id
    const next = queued.find((selection) => selection.configId === modelId) ?? queued[0]
    const remaining = queued.filter((selection) => selection !== next)

    this.publish({ queued: remaining.length ? remaining : undefined })
    void this.select(next)
  }

  async select(selection: SessionConfigSelection) {
    if (this.active && (this.streaming || this.snapshot.data?.status === 'busy')) {
      this.publish({
        queued: [
          ...(this.snapshot.queued ?? []).filter(
            (pending) => pending.configId !== selection.configId,
          ),
          selection,
        ],
      })

      return
    }
    if (
      !this.active ||
      this.snapshot.saving ||
      this.snapshot.error ||
      (this.snapshot.data?.status !== 'ready' && this.snapshot.data?.status !== 'dormant')
    )
      return
    const version = ++this.version

    clearTimeout(this.poll)
    clearTimeout(this.slowTimer)
    this.pending = false
    this.publish({ saving: true, slow: false, error: undefined })
    try {
      const data = await bounded(this.transport.write(selection), 40_000)

      if (this.active && version === this.version) this.publish({ data, loading: false })
    } catch {
      if (this.active && version === this.version)
        this.publish({
          queued: undefined,
          error: 'The change was not confirmed. Checking the current settings.',
        })
    } finally {
      if (this.active && version === this.version) {
        this.publish({ saving: false })
        // Readback after a failed/lost acknowledgement must precede another write.
        void this.refresh()
      }
    }
  }
}

function bounded<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>

  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Runtime request timed out')), timeoutMs)
    }),
  ]).finally(() => clearTimeout(timer))
}
