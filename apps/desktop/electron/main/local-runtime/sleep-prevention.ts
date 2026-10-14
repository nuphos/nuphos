export type SleepPreferences = {
  mode: 'off' | 'tasks' | 'host'
  onlyOnAC: boolean
}
export type SleepState = SleepPreferences & {
  supported: boolean
  active: boolean
  reason: 'unsupported' | 'off' | 'battery' | 'signed-out' | 'idle' | 'active'
}

export const DEFAULT_SLEEP_PREFERENCES: SleepPreferences = { mode: 'off', onlyOnAC: true }

export function parseSleepPreferences(value: unknown): SleepPreferences {
  if (!value || typeof value !== 'object') throw new Error('Invalid sleep preferences')
  const { mode, onlyOnAC } = value as Record<string, unknown>

  if (
    typeof mode !== 'string' ||
    !['off', 'tasks', 'host'].includes(mode) ||
    typeof onlyOnAC !== 'boolean'
  )
    throw new Error('Invalid sleep preferences')

  return { mode: mode as SleepPreferences['mode'], onlyOnAC }
}

/** One assertion for all agents; state changes never create duplicate blockers. */
type SleepDeps = {
  supported: boolean
  onBattery: () => boolean
  signedIn: () => boolean
  busy: () => boolean
  start: () => number
  stop: (id: number) => void
}

export class SleepPrevention {
  private id: number | undefined
  private preferences = { ...DEFAULT_SLEEP_PREFERENCES }
  private stopped = false
  private readonly deps: SleepDeps
  constructor(deps: SleepDeps) {
    this.deps = deps
  }

  configure(preferences: SleepPreferences): void {
    this.preferences = parseSleepPreferences(preferences)
  }

  state(): SleepState {
    const p = this.preferences
    const reason = this.reason()

    if (reason === 'active' && this.id === undefined) this.id = this.deps.start()
    if (reason !== 'active' && this.id !== undefined) {
      this.deps.stop(this.id)
      this.id = undefined
    }

    return { ...p, supported: this.deps.supported, active: this.id !== undefined, reason }
  }

  private reason(): SleepState['reason'] {
    if (!this.deps.supported) return 'unsupported'
    if (this.stopped || this.preferences.mode === 'off') return 'off'
    if (!this.deps.signedIn()) return 'signed-out'
    if (this.preferences.onlyOnAC && this.deps.onBattery()) return 'battery'
    if (this.preferences.mode === 'tasks' && !this.deps.busy()) return 'idle'

    return 'active'
  }

  dispose(): void {
    this.stopped = true
    this.state()
  }
}

/** Only pending ACP prompts count; an idle transport/control socket does not. */
export class RuntimeTaskActivity {
  private readonly streams = new Map<string, { purpose: string; prompts: Set<string | number> }>()
  private readonly changed: () => void
  constructor(changed: () => void) {
    this.changed = changed
  }

  busy(): boolean {
    return [...this.streams.values()].some(
      (s) => ['exec', 'terminal', 'cua'].includes(s.purpose) || s.prompts.size > 0,
    )
  }

  open(id: string, purpose: string): void {
    this.streams.set(id, { purpose, prompts: new Set() })
    this.changed()
  }

  data(id: string, raw: string, incoming: boolean): void {
    const stream = this.streams.get(id)

    if (stream?.purpose !== 'transport') return
    try {
      const message = JSON.parse(raw) as Record<string, unknown>
      const key = message.id

      if (typeof key !== 'string' && typeof key !== 'number') return
      if (incoming && message.method === 'session/prompt') stream.prompts.add(key)
      else if (!incoming && ('result' in message || 'error' in message)) stream.prompts.delete(key)
      this.changed()
    } catch {
      // Non-JSON traffic is not an ACP prompt.
    }
  }

  close(id: string): void {
    this.streams.delete(id)
    this.changed()
  }

  clear(): void {
    this.streams.clear()
    this.changed()
  }
}
