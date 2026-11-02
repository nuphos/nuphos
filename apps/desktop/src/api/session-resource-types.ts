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
  /** What blocks an open PR: failing checks, requested changes or a conflict. Shown as a mark beside the tag. */
  health?: 'checks_failed' | 'changes_requested' | 'conflict' | null
  /** An open PR still marked as a draft on GitHub. */
  draft?: boolean
  linkedAt: string
}

export type SessionResourcesResponse = { resources: SessionResource[]; canManage: boolean }
