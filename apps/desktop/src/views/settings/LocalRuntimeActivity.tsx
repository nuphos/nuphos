import clsx from 'clsx'
import { RotateCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { formatActivityTime } from './deviceActivity'
import { LoadFailed } from './shared'

import type { LocalRuntimeActivityEntry, LocalRuntimeActivityPage } from '../../api'
import type { ReactNode } from 'react'

const EMPTY_CLASSES =
  'rounded-lg border border-zGray-800/60 bg-surface p-4 text-[13px] text-tertiary'

function ActivityRow({
  entry,
  teamName,
  onOpenConversation,
}: {
  entry: LocalRuntimeActivityEntry
  teamName: string
  onOpenConversation?: (sessionId: string) => void
}) {
  const title = entry.conversationTitle ?? t('Untitled agent')

  return (
    <div className="border-t border-zGray-800/60 bg-surface px-4 py-2.5 first:border-t-0">
      <div className="flex items-center gap-2 text-[11px] text-tertiary">
        <span title={new Date(entry.lastServedAt).toLocaleString()}>
          {formatActivityTime(entry.lastServedAt)}
        </span>
        <span>·</span>
        <span className="truncate">{teamName}</span>
        <span>·</span>
        <span className="truncate">{entry.actorName ?? t('A teammate')}</span>
        <span className="ml-auto shrink-0 whitespace-nowrap">
          {entry.turns === 1 ? t('1 turn') : t('{n} turns', { n: entry.turns })}
        </span>
      </div>
      {onOpenConversation ? (
        <button
          type="button"
          onClick={() => onOpenConversation(entry.sessionId)}
          className="mt-1 block max-w-full truncate text-left text-[13px] text-main hover:underline"
        >
          {title}
        </button>
      ) : (
        <div className="mt-1 truncate text-[13px] text-main">{title}</div>
      )}
    </div>
  )
}

/** Conversations this computer served, for its owner only. */
export function LocalRuntimeActivity({
  currentTeamId,
  onOpenConversation,
}: {
  currentTeamId?: string
  onOpenConversation?: (sessionId: string) => void
}) {
  const [entries, setEntries] = useState<LocalRuntimeActivityEntry[] | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [teamNames, setTeamNames] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const applyPage = useCallback((page: LocalRuntimeActivityPage, append: boolean) => {
    setEntries((prev) => (append && prev ? [...prev, ...page.entries] : page.entries))
    setNextCursor(page.nextCursor)
  }, [])

  const load = useCallback(
    async (before?: string) => {
      setLoading(true)
      try {
        applyPage(await api.localRuntimeListActivity(before), before !== undefined)
        setFailed(false)
      } catch (err) {
        toast.apiError(t('Could not load local runtime activity'), err)
        if (before === undefined) setFailed(true)
      } finally {
        setLoading(false)
      }
    },
    [applyPage],
  )

  useEffect(() => {
    queueMicrotask(() => void load())
    void api
      .atlasListTeams()
      .then((teams) => {
        setTeamNames(new Map(teams.map((team) => [team.id, team.name])))
      })
      .catch(() => {})
  }, [load])

  let body: ReactNode

  if (entries === null)
    body = failed ? (
      <LoadFailed
        message={t('Couldn’t load local runtime activity.')}
        onRetry={() => void load()}
      />
    ) : (
      <p className={EMPTY_CLASSES}>{t('Loading…')}</p>
    )
  else if (entries.length === 0)
    body = <p className={EMPTY_CLASSES}>{t('No agent has run on this computer yet.')}</p>
  else
    body = (
      <>
        <div className="overflow-hidden rounded-lg border border-zGray-800/60">
          {entries.map((entry) => (
            <ActivityRow
              key={entry.id}
              entry={entry}
              teamName={teamNames.get(entry.teamId) ?? t('A team')}
              {...(entry.teamId === currentTeamId && onOpenConversation
                ? { onOpenConversation }
                : {})}
            />
          ))}
        </div>
        {nextCursor && (
          <div className="mt-2 flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              disabled={loading}
              onClick={() => void load(nextCursor)}
            >
              {loading ? t('Loading…') : t('Load more')}
            </Button>
          </div>
        )}
      </>
    )

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-main">{t('Activity')}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('Refresh local runtime activity')}
          disabled={loading}
          onClick={() => void load()}
        >
          <RotateCw strokeWidth={1.5} className={clsx('h-3.5 w-3.5', loading && 'animate-spin')} />
        </Button>
      </div>
      {body}
      <p className="mt-2 text-[11px] text-tertiary">
        {t('Every agent that ran here, by team. Kept for 90 days.')}
      </p>
    </div>
  )
}
