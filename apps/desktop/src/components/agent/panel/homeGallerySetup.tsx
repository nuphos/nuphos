import clsx from 'clsx'
import { ArrowLeft, Search } from 'lucide-react'
import { useEffect, useState } from 'react'

import { t } from '../../../i18n'
import { Button } from '../../ui/button'
import { Checkbox } from '../../ui/checkbox'
import { InputGroup, InputGroupInput } from '../../ui/input-group'

import { catalogEntry } from './homeCardCatalog'
import { GithubSample, SampleTag, ScaledCard } from './homeCardPreviews'
import { byNamespace, useGithubRepos } from './homeGithubRepos'
import { PULL_STATUSES, RUN_STATUSES, repoKey, toggleItem } from './homeWidgetSettings'

import type { HomeGithubCard, HomeRepo } from '../../../types/team.ts'

type GithubSetup = Pick<HomeGithubCard, 'repos' | 'statuses'>

const rowClass =
  'flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] transition-colors hover:bg-zGray-800/60'

/** The repositories to follow, grouped by owner, narrowed by a filter. */
function RepoPicker({
  teamId,
  chosen,
  onToggle,
}: {
  teamId: string
  chosen: HomeRepo[]
  onToggle: (repo: HomeRepo) => void
}) {
  const { repos, load } = useGithubRepos(teamId)
  const [filter, setFilter] = useState('')
  const shown = (repos ?? []).filter((r) =>
    r.fullName.toLowerCase().includes(filter.trim().toLowerCase()),
  )

  useEffect(load, [load])

  if (repos === null) {
    return (
      <div className="space-y-1.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-8 rounded-md bg-zGray-800/40 animate-pulse" />
        ))}
      </div>
    )
  }
  if (repos.length === 0) {
    return (
      <div className="py-3 text-[12.5px] text-tertiary">
        {t('No GitHub repositories connected')}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <InputGroup
        render={<label />}
        className="flex h-8 flex-none items-center gap-2 rounded-md border border-main bg-surface px-2 text-[13px] focus-within:border-zViolet-500"
      >
        <Search className="h-3.5 w-3.5 flex-none text-tertiary" strokeWidth={1.8} />
        <InputGroupInput
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('Filter repositories')}
          aria-label={t('Filter repositories')}
          className="text-main placeholder:text-tertiary"
        />
      </InputGroup>
      <div className="max-h-[220px] overflow-y-auto scrollbar-thin">
        {byNamespace(shown).map(([namespace, list]) => (
          <div key={namespace} role="group" aria-label={namespace} className="pb-1">
            <div className="px-2 pb-0.5 pt-1.5 text-[11px] font-medium text-tertiary">
              {namespace}
            </div>
            {list.map((repo) => (
              <label key={repo.fullName} className={rowClass}>
                <Checkbox
                  checked={chosen.some((r) => repoKey(r) === repoKey(repo))}
                  onCheckedChange={() => onToggle(repo)}
                  className="data-[checked]:border-zViolet-500 data-[checked]:bg-zViolet-500"
                />
                <span className="min-w-0 flex-1 truncate text-secondary">
                  {repo.fullName.split('/')[1]}
                </span>
              </label>
            ))}
          </div>
        ))}
        {shown.length === 0 && (
          <div className="px-2 py-2 text-[12.5px] text-tertiary">
            {t('No repositories match “{query}”', { query: filter.trim() })}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Setting up a pull request or CI card before it is added: which
 * repositories it follows and which of their pull requests or runs it shows,
 * with the card beside them drawn from sample rows for what is picked. Both can be
 * changed later from the card's ⋯ menu.
 */
export function GalleryGithubSetup({
  teamId,
  kind,
  onBack,
  onAdd,
}: {
  teamId: string
  kind: 'pulls' | 'ci'
  onBack: () => void
  onAdd: (setup: GithubSetup) => void
}) {
  const statuses = kind === 'pulls' ? PULL_STATUSES : RUN_STATUSES
  const [repos, setRepos] = useState<HomeRepo[]>([])
  // A new card starts with the first status: open pull requests, failing runs.
  const [picked, setPicked] = useState<string[]>(statuses.slice(0, 1).map((s) => s.value))
  const entry = catalogEntry(kind)

  return (
    <div className="flex flex-col pt-3">
      <Button variant="ghost" size="sm" autoFocus onClick={onBack} className="-ml-2 self-start">
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
        {t('All cards')}
      </Button>
      <h3 className="mt-2 text-[13px] font-medium text-main">
        {t('Set up {card}', { card: entry.title })}
      </h3>
      <p className="mb-3 mt-0.5 text-[12px] text-tertiary">
        {t('Pick what it follows. You can change it later from the card’s ⋯ menu.')}
      </p>
      <div className="grid gap-4 @2xl:grid-cols-2">
        <div className="relative h-[176px] overflow-hidden rounded-lg border border-main bg-zGray-900/40">
          {repos.length > 0 ? (
            <>
              <ScaledCard kind={kind}>
                <GithubSample kind={kind} repos={repos} statuses={picked} />
              </ScaledCard>
              <SampleTag />
            </>
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-[12.5px] text-tertiary">
              {t('Pick a repository to see the card')}
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <div role="group" aria-label={t('Show')} className="flex flex-wrap gap-1.5">
            {statuses.map((s) => {
              const on = picked.includes(s.value)

              return (
                <button
                  key={s.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    const next = toggleItem(picked, s.value, (v) => v)

                    // A card always shows something: the last status stays on.
                    if (next.length > 0) setPicked(next)
                  }}
                  className={clsx(
                    'h-7 rounded-full border px-3 text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-zViolet-accent',
                    on
                      ? 'border-zViolet-500 bg-zViolet-500/15 text-main'
                      : 'border-main text-secondary hover:bg-zGray-800/60',
                  )}
                >
                  {s.label}
                </button>
              )
            })}
          </div>
          <RepoPicker
            teamId={teamId}
            chosen={repos}
            onToggle={(repo) => setRepos(toggleItem(repos, repo, repoKey))}
          />
        </div>
      </div>
      <div className="mt-4 flex items-center justify-end gap-2">
        <span className="mr-auto text-[12px] text-tertiary tabular-nums">
          {repos.length === 1 ? t('1 repository') : t('{n} repositories', { n: repos.length })}
        </span>
        <Button variant="ghost" size="sm" onClick={onBack}>
          {t('Cancel')}
        </Button>
        <Button
          size="sm"
          disabled={repos.length === 0}
          onClick={() => onAdd({ repos, statuses: picked } as GithubSetup)}
        >
          {t('Add card')}
        </Button>
      </div>
    </div>
  )
}
