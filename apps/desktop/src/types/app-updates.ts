/** The app's own updater and the changelog Settings > Updates shows. */
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

export type ChangelogEntry = {
  slug: string
  title: string
  summary: string
  date: string
  coverUrl: string
  url: string
}

export type ChangelogState = { kind: 'unavailable' } | { kind: 'ready'; entries: ChangelogEntry[] }
