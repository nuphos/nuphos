import clsx from 'clsx'
import { RotateCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'

import { formatActivityTime } from './deviceActivity'

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
  const title = entry.conversationTitle ?? 'Untitled conversation'

  return (
    <div className="border-t border-zGray-800/60 bg-surface px-4 py-2.5 first:border-t-0">
      <div className="flex items-center gap-2 text-[11px] text-tertiary">
        <span title={new Date(entry.lastServedAt).toLocaleString()}>
          {formatActivityTime(entry.lastServedAt)}
        </span>
        <span>·</span>
        <span className="truncate">{teamName}</span>
        <span>·</span>
        <span className="truncate">{entry.actorName ?? 'A teammate'}</span>
        <span className="ml-auto shrink-0 whitespace-nowrap">
          {entry.turns} {entry.turns === 1 ? 'turn' : 'turns'}
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

  const applyPage = useCallback((page: LocalRuntimeActivityPage, append: boolean) => {
    setEntries((prev) => (append && prev ? [...prev, ...page.entries] : page.entries))
    setNextCursor(page.nextCursor)
  }, [])

  const load = useCallback(
    async (before?: string) => {
      setLoading(true)
      try {
        applyPage(await api.localRuntimeListActivity(before), before !== undefined)
      } catch (err) {
        toast.apiError('Could not load local agent activity', err)
        setEntries((prev) => prev ?? [])
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
      .catch(() => undefined)
  }, [load])

  let body: ReactNode

  if (entries === null) body = <p className={EMPTY_CLASSES}>Loading…</p>
  else if (entries.length === 0)
    body = <p className={EMPTY_CLASSES}>No conversation has run on this computer yet.</p>
  else
    body = (
      <>
        <div className="overflow-hidden rounded-lg border border-zGray-800/60">
          {entries.map((entry) => (
            <ActivityRow
              key={entry.id}
              entry={entry}
              teamName={teamNames.get(entry.teamId) ?? 'A team'}
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
              {loading ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
      </>
    )

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-main">Activity</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh local agent activity"
          disabled={loading}
          onClick={() => void load()}
        >
          <RotateCw strokeWidth={1.5} className={clsx('h-3.5 w-3.5', loading && 'animate-spin')} />
        </Button>
      </div>
      {body}
      <p className="mt-2 text-[11px] text-tertiary">
        Every conversation that ran here, by team. Kept for 90 days.
      </p>
    </div>
  )
}
