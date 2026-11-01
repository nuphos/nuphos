import { useCallback, useState } from 'react'

import { api } from '../../../api'

import type { HomeRepo } from '../../../types/team.ts'

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

/**
 * Every repository the team's GitHub App installations can reach, loaded the
 * first time `load` is called, as when a card's menu or the gallery opens.
 */
export function useGithubRepos(teamId: string) {
  const [repos, setRepos] = useState<HomeRepo[] | null>(null)
  const load = useCallback(() => {
    if (repos) return
    listGithubRepos(teamId).then(setRepos, () => setRepos([]))
  }, [teamId, repos])

  return { repos, load }
}

/** Repositories grouped by owner (an org or account), owners and names in order. */
export function byNamespace(repos: HomeRepo[]): [string, HomeRepo[]][] {
  const groups = new Map<string, HomeRepo[]>()

  for (const repo of repos.toSorted((a, b) => a.fullName.localeCompare(b.fullName))) {
    const namespace = repo.fullName.split('/')[0] ?? ''

    groups.set(namespace, [...(groups.get(namespace) ?? []), repo])
  }

  return [...groups]
}
