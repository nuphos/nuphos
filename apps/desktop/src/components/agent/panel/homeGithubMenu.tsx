import { ChevronRight, Ellipsis } from 'lucide-react'
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

import { PULL_STATUSES, RUN_STATUSES, repoKey, statusLabel, toggleItem } from './homeWidgetSettings'

import type { HomeGithubCard, HomeRepo } from './homeWidgetSettings'

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

const chevron = <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />

/** Repositories grouped by owner (an org or account), owners and names in order. */
function byNamespace(repos: HomeRepo[]): [string, HomeRepo[]][] {
  const groups = new Map<string, HomeRepo[]>()

  for (const repo of repos.toSorted((a, b) => a.fullName.localeCompare(b.fullName))) {
    const namespace = repo.fullName.split('/')[0] ?? ''

    groups.set(namespace, [...(groups.get(namespace) ?? []), repo])
  }

  return [...groups]
}

/** A GitHub card's ⋯ menu: which repositories it follows, what it shows of them, removal. */
export function GithubCardMenu({
  teamId,
  card,
  onChange,
  onRemove,
}: {
  teamId: string
  card: HomeGithubCard
  onChange: (card: HomeGithubCard) => void
  onRemove: () => void
}) {
  const { repos, load } = useGithubRepos(teamId)
  const statuses = card.kind === 'pulls' ? PULL_STATUSES : RUN_STATUSES
  const isFollowed = (repo: HomeRepo) => card.repos.some((r) => r.fullName === repo.fullName)

  return (
    <Menu onOpenChange={(open) => open && load()}>
      <MenuTrigger
        aria-label="Card settings"
        className="ml-auto rounded p-0.5 text-tertiary outline-none transition-colors hover:bg-zGray-800/60 hover:text-main"
      >
        <Ellipsis className="h-3.5 w-3.5" strokeWidth={1.8} />
      </MenuTrigger>
      <MenuContent align="end" className="w-[220px]">
        <MenuSubmenu>
          <MenuSubmenuTrigger chevron={chevron}>
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="flex-1">Repositories</span>
              <span className="text-[10.5px] text-tertiary tabular-nums">{card.repos.length}</span>
            </span>
          </MenuSubmenuTrigger>
          <MenuContent side="inline-end" align="start" className="w-[220px]">
            {repos === null && <MenuItem disabled>Loading repositories…</MenuItem>}
            {repos?.length === 0 && <MenuItem disabled>No GitHub repositories connected</MenuItem>}
            {byNamespace(repos ?? []).map(([namespace, list]) => (
              <MenuSubmenu key={namespace}>
                <MenuSubmenuTrigger chevron={chevron}>
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="flex-1 truncate">{namespace}</span>
                    <span className="text-[10.5px] text-tertiary tabular-nums">
                      {list.filter((r) => isFollowed(r)).length || ''}
                    </span>
                  </span>
                </MenuSubmenuTrigger>
                <MenuContent side="inline-end" align="start" className="w-[240px]">
                  {list.map((repo) => (
                    <MenuCheckboxItem
                      key={repo.fullName}
                      checked={isFollowed(repo)}
                      onCheckedChange={() =>
                        onChange({ ...card, repos: toggleItem(card.repos, repo, repoKey) })
                      }
                    >
                      <span className="block truncate">{repo.fullName.split('/')[1]}</span>
                    </MenuCheckboxItem>
                  ))}
                </MenuContent>
              </MenuSubmenu>
            ))}
          </MenuContent>
        </MenuSubmenu>
        <MenuSubmenu>
          <MenuSubmenuTrigger chevron={chevron}>
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="flex-1">Status</span>
              <span className="truncate text-[10.5px] text-tertiary">{statusLabel(card)}</span>
            </span>
          </MenuSubmenuTrigger>
          <MenuContent side="inline-end" align="start" className="w-[200px]">
            {statuses.map((s) => (
              <MenuCheckboxItem
                key={s.value}
                checked={(card.statuses as string[]).includes(s.value)}
                onCheckedChange={() => {
                  const next = toggleItem(card.statuses as string[], s.value, (v) => v)

                  // A card always shows something: the last status cannot be cleared.
                  if (next.length > 0) onChange({ ...card, statuses: next } as HomeGithubCard)
                }}
              >
                {s.label}
              </MenuCheckboxItem>
            ))}
          </MenuContent>
        </MenuSubmenu>
        <MenuSeparator />
        <MenuItem destructive onClick={onRemove}>
          Remove card
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
