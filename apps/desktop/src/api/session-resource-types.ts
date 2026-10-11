export type SessionResource = {
  id: string
  /** Slack and Discord entries are the session's chat thread; they cannot be unlinked here. */
  provider: 'github' | 'linear' | 'slack' | 'discord'
  title: string
  url: string
  state: string
  repository?: string
  number?: number
  linkedAt: string
}

export type SessionResourcesResponse = { resources: SessionResource[]; canManage: boolean }
