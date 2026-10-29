// Audit journal side panel: human-readable timeline of
// a conversation's tamper-evident journal with a live Integrity badge and
// bidirectional chat anchoring.
//
// The backend recomputes the hash chain on every fetch — the badge reflects an
// actual verification, not a cached claim. Message/content items additionally
// carry contentVerified (server recomputes the display copy's hash against the
// chained contentHash), rendered as a per-item ✓ / ⚠ mark.
//
// Narrative rendering is shared with the Audit log page via
// JournalEventBody.tsx / lib/journalEvent.ts.

import clsx from 'clsx'
import { RefreshCw, ShieldCheck, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { t } from '../../i18n'
import { toast } from '../ui/toast'

import { JournalIntegrityBadge } from './JournalEventBody'
import { JournalTimeline } from './JournalTimeline'

import type { AgentJournalResponse } from '../../api'
import type { JournalChatTarget } from '../../lib/journalEvent'

export type { JournalChatTarget }

export function JournalSidePanel({
  sessionId,
  teamId,
  onClose,
  onLocateInChat,
  focusTarget,
}: {
  sessionId: string
  teamId?: string
  onClose: () => void
  /** journal -> chat: scroll the transcript to the event's message/tool card. */
  onLocateInChat?: (target: JournalChatTarget) => void
  /** chat -> journal: entry the panel should scroll to and highlight. */
  focusTarget?: JournalChatTarget | null
}) {
  const [data, setData] = useState<AgentJournalResponse | null>(null)
  const [loading, setLoading] = useState(true)
  // Bumping the nonce re-runs the fetch effect; the manual refresh button owns
  // the synchronous loading flip so the effect body stays setState-free.
  const [refreshNonce, setRefreshNonce] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)

  const refresh = useCallback(() => {
    setLoading(true)
    setRefreshNonce((nonce) => nonce + 1)
  }, [])

  useEffect(() => {
    let cancelled = false

    api
      .agentGetJournal(sessionId, teamId)
      .then((response) => {
        if (!cancelled) setData(response)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        toast.apiError(t('Failed to load audit journal'), err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [sessionId, teamId, refreshNonce])

  // chat -> journal focus: once data is present, scroll to the anchored entry.
  useEffect(() => {
    if (!focusTarget || !data || !listRef.current) return
    const key = focusTarget.toolCallId
      ? `[data-anchor-tool="${CSS.escape(focusTarget.toolCallId)}"]`
      : focusTarget.messageId
        ? `[data-anchor-message="${CSS.escape(focusTarget.messageId)}"]`
        : null

    if (!key) return
    const el = listRef.current.querySelector<HTMLElement>(key)

    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const flash = ['bg-violet-500/15']

    el.classList.add(...flash)
    const timer = window.setTimeout(() => el.classList.remove(...flash), 1600)

    return () => window.clearTimeout(timer)
  }, [focusTarget, data])

  const integrity = data?.integrity

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-2 border-b border-zGray-800 px-4 py-3">
        <ShieldCheck className="h-4 w-4 text-tertiary" strokeWidth={1.8} />
        <span className="text-sm font-medium text-main">{t('Audit journal')}</span>
        {integrity && <JournalIntegrityBadge level={integrity.level} />}
        <div className="flex-1" />
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="flex h-6 w-6 items-center justify-center rounded-md text-tertiary hover:bg-zGray-800/60 hover:text-main disabled:opacity-50"
          title={t('Refresh')}
          aria-label={t('Refresh journal')}
        >
          <RefreshCw className={clsx('h-3.5 w-3.5', loading && 'animate-spin')} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-md text-tertiary hover:bg-zGray-800/60 hover:text-main"
          title={t('Close')}
          aria-label={t('Close journal panel')}
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      </div>

      {integrity && !integrity.chainOk && (
        <div className="border-b border-error/30 bg-error/10 px-4 py-2 text-xs text-error">
          {integrity.violationCount === 1
            ? t(
                'Chain verification failed (1 violation) — these records can no longer be trusted as-written.',
              )
            : t(
                'Chain verification failed ({n} violations) — these records can no longer be trusted as-written.',
                { n: integrity.violationCount },
              )}{' '}
          {t('First: {message}', { message: integrity.violations[0]?.message ?? t('unknown') })}
        </div>
      )}
      {integrity && integrity.chainOk && (integrity.contentDivergenceCount ?? 0) > 0 && (
        <div className="border-b border-error/30 bg-error/10 px-4 py-2 text-xs text-error">
          {integrity.contentDivergenceCount === 1
            ? t(
                '1 displayed item no longer match the chained hash — the hot copy was modified after journaling. Items are marked ⚠ below.',
              )
            : t(
                '{n} displayed items no longer match the chained hash — the hot copy was modified after journaling. Items are marked ⚠ below.',
                { n: integrity.contentDivergenceCount ?? 0 },
              )}
        </div>
      )}

      <div
        ref={listRef}
        className="flex-1 min-h-0 overflow-auto scrollbar-thin px-4 py-3 selectable"
      >
        {loading && !data ? (
          <div className="py-8 text-center text-xs text-tertiary">{t('Loading journal…')}</div>
        ) : !data || data.events.length === 0 ? (
          <div className="py-8 text-center text-xs text-tertiary">
            {t('No journal events yet — they appear as the agent works.')}
          </div>
        ) : (
          <JournalTimeline
            events={data.events}
            sealedThrough={integrity?.sealedThrough ?? 0}
            truncated={integrity?.truncated === true}
            onLocateInChat={onLocateInChat}
          />
        )}
        {integrity?.truncated && (
          <div className="py-2 text-center text-[10px] text-tertiary">
            {t('Showing the first {shown} of {total} events.', {
              shown: data?.events.length ?? 0,
              total: integrity.eventCount,
            })}
          </div>
        )}
      </div>

      {integrity && (
        <div className="border-t border-zGray-800 px-4 py-2 text-[10px] leading-4 text-tertiary">
          {t('{n} events · chain head', { n: integrity.eventCount })}{' '}
          <span className="font-mono">{integrity.headHash?.slice(0, 12) ?? '—'}</span>
          {integrity.lastAnchorAt
            ? ` · ${t('last external anchor {time}', {
                time: new Date(integrity.lastAnchorAt).toLocaleString(),
              })}`
            : ` · ${t('not externally anchored yet')}`}
        </div>
      )}
    </div>
  )
}
