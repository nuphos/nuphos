import { ChevronRight, LayoutGrid } from 'lucide-react'
import { useCallback, useState } from 'react'

import { api } from '../../../api'
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuSubmenu,
  MenuSubmenuTrigger,
  MenuTrigger,
} from '../../ui/menu'

import { CiFailuresCard, PullRequestsCard } from './homeCards'
import { loadHomeWidgets, saveHomeWidgets, toggleRepo } from './homeWidgetSettings'

import type { HomeRepo, HomeWidgetSettings } from './homeWidgetSettings'

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
  label,
  available,
  selected,
  onToggle,
}: {
  label: string
  available: HomeRepo[] | null
  selected: HomeRepo[]
  onToggle: (repo: HomeRepo) => void
}) {
  return (
    <MenuSubmenu>
      <MenuSubmenuTrigger chevron={<ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />}>
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
 * The configurable cards under the home composer. Each card follows the
 * repositories picked for it in "Customize" and is hidden when it follows none.
 */
export function HomeWidgets({ teamId }: { teamId: string }) {
  const [settings, setSettings] = useState<HomeWidgetSettings>(() => loadHomeWidgets(teamId))
  const { repos, load } = useGithubRepos(teamId)
  const toggle = (card: keyof HomeWidgetSettings) => (repo: HomeRepo) => {
    const next = { ...settings, [card]: toggleRepo(settings[card], repo) }

    setSettings(next)
    saveHomeWidgets(teamId, next)
  }

  return (
    <div className="mb-6">
      <div className="mb-2 flex justify-end">
        <Menu onOpenChange={(open) => open && load()}>
          <MenuTrigger className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-tertiary transition-colors hover:bg-zGray-800/60 hover:text-main">
            <LayoutGrid className="h-3.5 w-3.5" strokeWidth={1.8} />
            Customize
          </MenuTrigger>
          <MenuContent align="end" className="w-[200px]">
            <RepoSubmenu
              label="Pull requests"
              available={repos}
              selected={settings.pulls}
              onToggle={toggle('pulls')}
            />
            <RepoSubmenu
              label="CI failures"
              available={repos}
              selected={settings.ci}
              onToggle={toggle('ci')}
            />
          </MenuContent>
        </Menu>
      </div>
      {(settings.pulls.length > 0 || settings.ci.length > 0) && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {settings.pulls.length > 0 && <PullRequestsCard teamId={teamId} repos={settings.pulls} />}
          {settings.ci.length > 0 && <CiFailuresCard teamId={teamId} repos={settings.ci} />}
        </div>
      )}
    </div>
  )
}
