export type SessionResource = {
  id: string
  /** Slack and Discord entries are the session's chat thread; unlinking unbinds it. */
  provider: 'github' | 'linear' | 'slack' | 'discord'
  title: string
  url: string
  state: string
  /** Linear workflow state type, e.g. `started` or `completed`. */
  stateType?: string
  repository?: string
  number?: number
  linkedAt: string
}

export type SessionResourcesResponse = { resources: SessionResource[]; canManage: boolean }
