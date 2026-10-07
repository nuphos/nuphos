import { ChevronRight, CircleX, GitPullRequest, LayoutGrid } from 'lucide-react'
import { useCallback, useState } from 'react'

import { api } from '../../../api'
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuSubmenu,
  MenuSubmenuTrigger,
  MenuTrigger,
} from '../../ui/menu'

import { CiFailuresCard, PullRequestsCard } from './homeCards'
import { DashboardPanelCard } from './homePanelCard'
import { DashboardPanelsSubmenu } from './homePanelPicker'
import { TeamActivityCard } from './homeTeamCard'
import { panelKey, repoKey, toggleItem } from './homeWidgetSettings'
import { useHomeLayout } from './useHomeLayout'

import type { HomePanel, HomeRepo } from './homeWidgetSettings'
import type { ReactNode } from 'react'

async function listInstallationRepos(teamId: string, installationId: number): Promise<HomeRepo[]> {
  const repos = await api.atlasListGithubRepositories(teamId, installationId)

  return repos.map((r) => ({ installationId, fullName: r.fullName }))
}

async function listGithubRepos(teamId: string): Promise<HomeRepo[]> {
  const installations = await api.atlasListGithubInstallations(teamId)
  const lists = await Promise.allSettled(
    installations.map((inst) => listInstallationRepos(teamId, inst.installationId)),
  )

  return lists.flatMap((l) => (l.status === 'fulfilled' ? l.value : []))
}

/** Every repository the team's GitHub App installations can reach, loaded when the menu first opens. */
function useGithubRepos(teamId: string) {
  const [repos, setRepos] = useState<HomeRepo[] | null>(null)
  const load = useCallback(() => {
    if (repos) return
    listGithubRepos(teamId).then(setRepos, () => setRepos([]))
  }, [teamId, repos])

  return { repos, load }
}

function RepoSubmenu({
  icon,
  label,
  available,
  selected,
  onToggle,
}: {
  icon: ReactNode
  label: string
  available: HomeRepo[] | null
  selected: HomeRepo[]
  onToggle: (repo: HomeRepo) => void
}) {
  return (
    <MenuSubmenu>
      <MenuSubmenuTrigger
        icon={icon}
        chevron={<ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex-1">{label}</span>
          <span className="text-[10.5px] text-tertiary tabular-nums">
            {selected.length || 'Off'}
          </span>
        </span>
      </MenuSubmenuTrigger>
      <MenuContent side="inline-end" align="start" className="w-[260px]">
        {available === null && <MenuItem disabled>Loading repositories…</MenuItem>}
        {available?.length === 0 && <MenuItem disabled>No GitHub repositories connected</MenuItem>}
        {available?.map((repo) => (
          <MenuCheckboxItem
            key={`${String(repo.installationId)}/${repo.fullName}`}
            checked={selected.some((r) => r.fullName === repo.fullName)}
            onCheckedChange={() => onToggle(repo)}
          >
            <span className="block truncate">{repo.fullName}</span>
          </MenuCheckboxItem>
        ))}
      </MenuContent>
    </MenuSubmenu>
  )
}

/**
 * The configurable cards under the home composer, all picked in "Customize":
 * team activity is on or off, each GitHub card follows its own repositories
 * and is hidden when it follows none, and every pinned dashboard panel is a
 * card of its own.
 */
export function HomeWidgets({
  teamId,
  isTeamAdmin = false,
  onOpenConversation,
}: {
  teamId: string
  /** Administrators can make their layout the team default. */
  isTeamAdmin?: boolean
  onOpenConversation?: (sessionId: string, title: string) => void
}) {
  const home = useHomeLayout(teamId)
  const { repos, load } = useGithubRepos(teamId)

  if (!home.layout) return null
  const settings = home.layout
  const update = home.update
  const toggle = (card: 'pulls' | 'ci') => (repo: HomeRepo) =>
    update({ ...settings, [card]: toggleItem(settings[card], repo, repoKey) })
  const togglePanel = (pin: HomePanel) =>
    update({ ...settings, panels: toggleItem(settings.panels, pin, panelKey) })
  const anyCard =
    settings.team || settings.pulls.length + settings.ci.length + settings.panels.length > 0

  return (
    <div className="mb-6">
      <div className="mb-2 flex justify-end">
        <Menu onOpenChange={(open) => open && load()}>
          <MenuTrigger className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-tertiary transition-colors hover:bg-zGray-800/60 hover:text-main">
            <LayoutGrid className="h-3.5 w-3.5" strokeWidth={1.8} />
            Customize
          </MenuTrigger>
          <MenuContent align="end" className="w-[232px]">
            <MenuCheckboxItem
              checked={settings.team}
              onCheckedChange={(team) => update({ ...settings, team })}
            >
              Team activity
            </MenuCheckboxItem>
            <RepoSubmenu
              icon={<GitPullRequest className="h-3.5 w-3.5" strokeWidth={1.8} />}
              label="Pull requests"
              available={repos}
              selected={settings.pulls}
              onToggle={toggle('pulls')}
            />
            <RepoSubmenu
              icon={<CircleX className="h-3.5 w-3.5" strokeWidth={1.8} />}
              label="CI failures"
              available={repos}
              selected={settings.ci}
              onToggle={toggle('ci')}
            />
            <DashboardPanelsSubmenu
              teamId={teamId}
              selected={settings.panels}
              onToggle={togglePanel}
            />
            <MenuSeparator />
            <MenuItem disabled={!home.customized} onClick={home.resetToTeamDefault}>
              Reset to team default
            </MenuItem>
            {isTeamAdmin && (
              <MenuItem onClick={home.setAsTeamDefault}>Set as team default</MenuItem>
            )}
          </MenuContent>
        </Menu>
      </div>
      {anyCard && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {settings.team && (
            <TeamActivityCard teamId={teamId} onOpenConversation={onOpenConversation} />
          )}
          {settings.pulls.length > 0 && <PullRequestsCard teamId={teamId} repos={settings.pulls} />}
          {settings.ci.length > 0 && <CiFailuresCard teamId={teamId} repos={settings.ci} />}
          {settings.panels.map((pin) => (
            <DashboardPanelCard
              key={panelKey(pin)}
              teamId={teamId}
              pin={pin}
              onUnpin={() => togglePanel(pin)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
