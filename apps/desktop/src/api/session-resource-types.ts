export type SessionResource = {
  id: string
  /** Slack and Discord entries are the session's chat thread; unlinking unbinds it. */
  provider: 'github' | 'gitlab' | 'linear' | 'slack' | 'discord'
  title: string
  url: string
  state: string
  /** Linear workflow state type, e.g. `started` or `completed`. */
  stateType?: string
  repository?: string
  number?: number
  /** What blocks an open PR: failing checks, requested changes or a conflict. Shown as a mark beside the tag. */
  health?: 'checks_failed' | 'changes_requested' | 'conflict' | null
  /** An open PR or merge request still marked as a draft. */
  draft?: boolean
  linkedAt: string
}

/** A GitHub pull request or a GitLab merge request: both show as pull-request tags. */
export function isPull(resource: Pick<SessionResource, 'provider'>) {
  return resource.provider === 'github' || resource.provider === 'gitlab'
}

export type SessionResourcesResponse = { resources: SessionResource[]; canManage: boolean }
