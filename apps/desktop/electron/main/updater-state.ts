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
