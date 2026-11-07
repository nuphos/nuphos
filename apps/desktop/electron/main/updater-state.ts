export type UpdaterState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | {
      kind: 'downloading'
      version: string
      transferred: number
      total: number
      bytesPerSecond: number
    }
  | { kind: 'ready'; version: string }
  | { kind: 'error' }

/**
 * Whether `next` may replace `current`. A downloaded update stays ready, and
 * installable, while later checks run; only a newer version finishing its
 * download replaces it. So an app left open across several releases restarts
 * into the latest one, not into the first it happened to download.
 */
export function acceptsUpdaterState(current: UpdaterState, next: UpdaterState): boolean {
  if (current.kind !== 'ready') return true

  return next.kind === 'ready' && next.version !== current.version
}
