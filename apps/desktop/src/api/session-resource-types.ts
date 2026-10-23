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
  /** What blocks an open PR: failing checks (red), or requested changes or a conflict (yellow). */
  health?: 'checks_failed' | 'changes_requested' | 'conflict' | null
  linkedAt: string
}

export type SessionResourcesResponse = { resources: SessionResource[]; canManage: boolean }
