import { Collapsible } from '@base-ui/react/collapsible'
import { faChevronRight, faRotateRight } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'
import { useCallback, useEffect, useState } from 'react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'

import {
  commandPreview,
  formatActivityTime,
  formatDuration,
  originLabel,
  outcomeSummary,
} from './deviceActivity'

import type { OutcomeTone } from './deviceActivity'
import type { DeviceExecAuditEntry, DeviceExecAuditPage } from '../../api'
import type { ReactNode } from 'react'

const EMPTY_CLASSES =
  'rounded-lg border border-zGray-800/60 bg-surface p-4 text-[13px] text-tertiary'

const TONE_CLASSES: Record<OutcomeTone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
  muted: 'text-tertiary',
}

function ActivityRow({
  entry,
  canOpenConversation,
  onOpenConversation,
}: {
  entry: DeviceExecAuditEntry
  canOpenConversation: boolean
  onOpenConversation?: (sessionId: string) => void
}) {
  const outcome = outcomeSummary(entry)
  const preview = commandPreview(entry.command)
  const title = entry.conversationTitle ?? 'Untitled conversation'

  return (
    <div className="border-t border-zGray-800/60 bg-surface px-4 py-2.5 first:border-t-0">
      <div className="flex items-center gap-2 text-[11px] text-tertiary">
        <span title={new Date(entry.requestedAt).toLocaleString()}>
          {formatActivityTime(entry.requestedAt)}
        </span>
        <span>·</span>
        <span>{originLabel(entry.origin)}</span>
        <span>·</span>
        {canOpenConversation && onOpenConversation ? (
          <button
            type="button"
            onClick={() => onOpenConversation(entry.sessionId)}
            className="min-w-0 truncate text-secondary hover:text-main hover:underline"
          >
            {title}
          </button>
        ) : (
          <span className="min-w-0 truncate">{title}</span>
        )}
        <span className="ml-auto flex-shrink-0 whitespace-nowrap">
          <span className={clsx('font-medium', TONE_CLASSES[outcome.tone])}>{outcome.label}</span>
          {entry.outcome !== 'rejected' && <span> · {formatDuration(entry.durationMs)}</span>}
        </span>
      </div>
      {preview.truncated ? (
        <Collapsible.Root className="mt-1">
          <Collapsible.Trigger className="group flex w-full min-w-0 items-center gap-1.5 text-left font-mono text-[12px] text-main">
            <FontAwesomeIcon
              icon={faChevronRight}
              className="h-2 w-2 flex-shrink-0 text-tertiary transition-transform group-data-[panel-open]:rotate-90"
            />
            <span className="truncate group-data-[panel-open]:hidden">{preview.text}</span>
            <span className="hidden text-tertiary group-data-[panel-open]:inline">
              Full command
            </span>
          </Collapsible.Trigger>
          <Collapsible.Panel>
            <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-md bg-field px-2.5 py-2 font-mono text-[12px] text-main">
              {entry.command}
            </pre>
          </Collapsible.Panel>
        </Collapsible.Root>
      ) : (
        <div className="mt-1 truncate font-mono text-[12px] text-main">{preview.text}</div>
      )}
    </div>
  )
}

export function DeviceActivityList({
  currentTeamId,
  onOpenConversation,
}: {
  currentTeamId?: string
  onOpenConversation?: (sessionId: string) => void
}) {
  const [entries, setEntries] = useState<DeviceExecAuditEntry[] | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const applyPage = useCallback((page: DeviceExecAuditPage, append: boolean) => {
    setEntries((prev) => (append && prev ? [...prev, ...page.entries] : page.entries))
    setNextCursor(page.nextCursor)
  }, [])

  useEffect(() => {
    let cancelled = false

    api
      .deviceListAudit()
      .then((page) => {
        if (!cancelled) applyPage(page, false)
      })
      .catch((err: unknown) => {
        toast.apiError('Could not load recent activity', err)
        if (!cancelled) setEntries([])
      })

    return () => {
      cancelled = true
    }
  }, [applyPage])

  async function load(before?: string) {
    setLoading(true)
    try {
      applyPage(await api.deviceListAudit(before), before !== undefined)
    } catch (err) {
      toast.apiError('Could not load recent activity', err)
    } finally {
      setLoading(false)
    }
  }

  let body: ReactNode

  if (entries === null) {
    body = <p className={EMPTY_CLASSES}>Loading…</p>
  } else if (entries.length === 0) {
    body = <p className={EMPTY_CLASSES}>Nothing has run on this device yet.</p>
  } else {
    body = (
      <>
        <div className="overflow-hidden rounded-lg border border-zGray-800/60">
          {entries.map((entry) => (
            <ActivityRow
              key={entry.id}
              entry={entry}
              canOpenConversation={entry.teamId === currentTeamId}
              onOpenConversation={onOpenConversation}
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
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-main">Recent activity</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh recent activity"
          disabled={loading}
          onClick={() => void load()}
        >
          <FontAwesomeIcon
            icon={faRotateRight}
            className={clsx('h-3 w-3', loading && 'animate-spin')}
          />
        </Button>
      </div>
      {body}
      <p className="mt-2 text-[11px] text-tertiary">
        Kept for 90 days. Command output isn't recorded here; obvious tokens are masked on a
        best-effort basis.
      </p>
    </div>
  )
}
