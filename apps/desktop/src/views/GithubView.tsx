import clsx from 'clsx'
import { createPortal } from 'react-dom'

import { useToolbarSlot } from '../hooks/useToolbarControls'
import { useToolbarPrimaryAction } from '../hooks/useToolbarPrimaryAction'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'

import { GithubPullRequestView } from './GithubPullRequestView'
import { GithubRepoDetailView } from './GithubRepoDetailView'
import { GithubRepoListView } from './GithubRepoListView'
import { RepositoryHomeView } from './RepositoryHomeView'

import type { GithubPRState, GithubRepoTab } from './GithubRepoDetailView'
import type { GithubInstallation, GithubRepository } from '../types'

const PR_STATES: readonly GithubPRState[] = ['open', 'closed', 'all']

export type GithubNavState =
  | { view: 'installations' }
  | { view: 'repos'; installation: GithubInstallation }
  | {
      view: 'repo'
      installation: GithubInstallation
      repo: GithubRepository
      tab: GithubRepoTab
      prState: GithubPRState
    }
  | {
      view: 'pull'
      installation: GithubInstallation
      repo: GithubRepository
      prNumber: number
      prTitle: string
      prState: GithubPRState
    }

type Props = {
  teamId: string
  filter: string
  refreshKey: number
  onCount: (n: number) => void
  nav: GithubNavState
  onNavChange: (nav: GithubNavState) => void
  onConnectGithub: () => void
  onLoading?: (loading: boolean) => void
}

export function GithubView({
  teamId,
  filter,
  refreshKey,
  onCount,
  nav,
  onNavChange,
  onConnectGithub,
  onLoading,
}: Props) {
  const { isActive } = useWorkspaceTab()

  // The connect CTA belongs to the installations landing (no repo bound yet);
  // published to the shared toolbar rather than an App-level hardcoded branch.
  useToolbarPrimaryAction(
    isActive && nav.view === 'installations' ? 'Connect GitHub' : null,
    onConnectGithub,
  )
  // The PR open/closed/all filter rides the toolbar's left slot next to the
  // search box, but only while this is the active tab on the PR list.
  const prFilterActive = isActive && nav.view === 'repo' && nav.tab === 'prs'
  const leftSlot = useToolbarSlot('left', prFilterActive)

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {leftSlot &&
        nav.view === 'repo' &&
        createPortal(
          <div className="flex items-center gap-1">
            {PR_STATES.map((state) => (
              <button
                key={state}
                type="button"
                className={clsx(
                  'h-7 px-2.5 rounded-md text-[12px] transition-colors',
                  nav.prState === state
                    ? 'bg-zGray-800 text-main'
                    : 'text-tertiary hover:text-secondary hover:bg-zGray-800/50',
                )}
                onClick={() => {
                  onNavChange({ ...nav, prState: state })
                }}
              >
                {state.charAt(0).toUpperCase() + state.slice(1)}
              </button>
            ))}
          </div>,
          leftSlot,
        )}
      {nav.view === 'installations' && (
        <RepositoryHomeView
          key={teamId}
          teamId={teamId}
          filter={filter}
          refreshKey={refreshKey}
          onCount={onCount}
          onConnectGithub={onConnectGithub}
          onSelectInstallation={(installation) => onNavChange({ view: 'repos', installation })}
        />
      )}

      {nav.view === 'repos' && (
        <GithubRepoListView
          teamId={teamId}
          installation={nav.installation}
          filter={filter}
          refreshKey={refreshKey}
          onCount={onCount}
          onLoading={onLoading}
          onSelectRepo={(repo) => {
            onNavChange({
              view: 'repo',
              installation: nav.installation,
              repo,
              tab: 'prs',
              prState: 'open',
            })
          }}
        />
      )}

      {nav.view === 'repo' && (
        <GithubRepoDetailView
          teamId={teamId}
          installation={nav.installation}
          repo={nav.repo}
          filter={filter}
          refreshKey={refreshKey}
          onCount={onCount}
          tab={nav.tab}
          prState={nav.prState}
          onSelectPull={(pr) =>
            onNavChange({
              view: 'pull',
              installation: nav.installation,
              repo: nav.repo,
              prNumber: pr.number,
              prTitle: pr.title,
              prState: nav.prState,
            })
          }
        />
      )}

      {nav.view === 'pull' && (
        <GithubPullRequestView
          key={`${String(nav.installation.installationId)}:${nav.repo.fullName}:${String(nav.prNumber)}`}
          teamId={teamId}
          installation={nav.installation}
          repo={nav.repo}
          pullNumber={nav.prNumber}
          refreshKey={refreshKey}
          onCount={onCount}
          onLoaded={(title) => {
            if (title === nav.prTitle) return
            onNavChange({ ...nav, prTitle: title })
          }}
        />
      )}
    </div>
  )
}
