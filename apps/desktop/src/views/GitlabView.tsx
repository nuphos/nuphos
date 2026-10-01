import { useEffect, useRef } from 'react'

import { useToolbarPrimaryAction } from '../hooks/useToolbarPrimaryAction'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'

import { BindingsList } from './gitlab/GitlabBindingsList'
import { ProjectDetail } from './gitlab/GitlabProjectDetail'
import { ProjectsList } from './gitlab/GitlabProjectsList'

import type { GitlabNavState } from './gitlabNav'

type Props = {
  teamId: string
  filter: string
  refreshKey: number
  onCount: (n: number) => void
  onConnectGitlab: () => void
  nav: GitlabNavState
  onNavChange: (nav: GitlabNavState) => void
}

export function GitlabView({
  teamId,
  filter,
  refreshKey,
  onCount,
  onConnectGitlab,
  nav,
  onNavChange,
}: Props) {
  const setNav = onNavChange
  const { isActive } = useWorkspaceTab()

  // "Connect GitLab" stays available across the GitLab views (you can bind more
  // instances); published to the shared toolbar instead of an App-level branch.
  useToolbarPrimaryAction(isActive ? 'Connect GitLab' : null, onConnectGitlab)
  // Reset to root when the team switches inside the same tab — the nav may
  // reference a binding that belongs to the previous team.
  const prevTeamRef = useRef(teamId)

  useEffect(() => {
    if (prevTeamRef.current !== teamId) {
      prevTeamRef.current = teamId
      onNavChange({ view: 'bindings' })
    }
  }, [teamId, onNavChange])

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {nav.view !== 'bindings' && (
        <div className="px-3 py-2 border-b border-zGray-800 text-[12px] text-tertiary flex items-center gap-2 flex-shrink-0">
          <button onClick={() => setNav({ view: 'bindings' })} className="hover:text-secondary">
            GitLab accounts
          </button>
          {nav.view === 'projects' && (
            <>
              <span>/</span>
              <span className="text-main">
                {nav.namespace ? nav.namespace.fullPath : `@${nav.binding.username}`}
              </span>
            </>
          )}
          {nav.view === 'project' && (
            <>
              <span>/</span>
              <button
                onClick={() =>
                  setNav({ view: 'projects', binding: nav.binding, namespace: nav.namespace })
                }
                className="hover:text-secondary"
              >
                {nav.namespace ? nav.namespace.fullPath : `@${nav.binding.username}`}
              </button>
              <span>/</span>
              <span className="text-main">{nav.project.pathWithNamespace}</span>
            </>
          )}
        </div>
      )}

      {nav.view === 'bindings' && (
        <BindingsList
          teamId={teamId}
          filter={filter}
          refreshKey={refreshKey}
          onCount={onCount}
          onConnectGitlab={onConnectGitlab}
          onSelect={(binding) => setNav({ view: 'projects', binding })}
        />
      )}
      {nav.view === 'projects' && (
        <ProjectsList
          teamId={teamId}
          binding={nav.binding}
          namespace={nav.namespace}
          filter={filter}
          refreshKey={refreshKey}
          onCount={onCount}
          onSelect={(project) =>
            setNav({
              view: 'project',
              binding: nav.binding,
              namespace: nav.namespace,
              project,
              tab: 'merge-requests',
              mrState: 'opened',
            })
          }
        />
      )}
      {nav.view === 'project' && (
        <ProjectDetail
          teamId={teamId}
          binding={nav.binding}
          project={nav.project}
          filter={filter}
          refreshKey={refreshKey}
          onCount={onCount}
          tab={nav.tab}
          mrState={nav.mrState}
          onTabChange={(tab) => setNav({ ...nav, tab })}
          onMrStateChange={(mrState) => setNav({ ...nav, mrState })}
        />
      )}
    </div>
  )
}
