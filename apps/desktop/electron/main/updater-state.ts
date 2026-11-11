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
  /** installerUrl: set when the last restart came back without this version. */
  | { kind: 'ready'; version: string; installerUrl: string | null }
  | { kind: 'error' }
