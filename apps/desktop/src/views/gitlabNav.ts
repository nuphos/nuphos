import type { GitlabBinding, GitlabNamespace, GitlabProject } from '../types'

export type GitlabMrState = 'opened' | 'closed' | 'merged' | 'all'
export type GitlabProjectTab = 'merge-requests' | 'pipelines'

export type GitlabNavState =
  | { view: 'bindings' }
  | { view: 'projects'; binding: GitlabBinding; namespace?: GitlabNamespace }
  | {
      view: 'project'
      binding: GitlabBinding
      namespace?: GitlabNamespace
      project: GitlabProject
      tab: GitlabProjectTab
      mrState: GitlabMrState
    }

export const DEFAULT_GITLAB_NAV: GitlabNavState = { view: 'bindings' }
