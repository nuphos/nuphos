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
        toast.apiError('Failed to load audit journal', err)
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
        <span className="text-sm font-medium text-main">Audit journal</span>
        {integrity && <JournalIntegrityBadge level={integrity.level} />}
        <div className="flex-1" />
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="flex h-6 w-6 items-center justify-center rounded-md text-tertiary hover:bg-zGray-800/60 hover:text-main disabled:opacity-50"
          title="Refresh"
          aria-label="Refresh journal"
        >
          <RefreshCw className={clsx('h-3.5 w-3.5', loading && 'animate-spin')} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-md text-tertiary hover:bg-zGray-800/60 hover:text-main"
          title="Close"
          aria-label="Close journal panel"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      </div>

      {integrity && !integrity.chainOk && (
        <div className="border-b border-error/30 bg-error/10 px-4 py-2 text-xs text-error">
          Chain verification failed ({integrity.violationCount} violation
          {integrity.violationCount === 1 ? '' : 's'}) — these records can no longer be trusted
          as-written. First: {integrity.violations[0]?.message ?? 'unknown'}
        </div>
      )}
      {integrity && integrity.chainOk && (integrity.contentDivergenceCount ?? 0) > 0 && (
        <div className="border-b border-error/30 bg-error/10 px-4 py-2 text-xs text-error">
          {integrity.contentDivergenceCount} displayed item
          {integrity.contentDivergenceCount === 1 ? '' : 's'} no longer match the chained hash — the
          hot copy was modified after journaling. Items are marked ⚠ below.
        </div>
      )}

      <div
        ref={listRef}
        className="flex-1 min-h-0 overflow-auto scrollbar-thin px-4 py-3 selectable"
      >
        {loading && !data ? (
          <div className="py-8 text-center text-xs text-tertiary">Loading journal…</div>
        ) : !data || data.events.length === 0 ? (
          <div className="py-8 text-center text-xs text-tertiary">
            No journal events yet — they appear as the agent works.
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
            Showing the first {data?.events.length} of {integrity.eventCount} events.
          </div>
        )}
      </div>

      {integrity && (
        <div className="border-t border-zGray-800 px-4 py-2 text-[10px] leading-4 text-tertiary">
          {integrity.eventCount} events · chain head{' '}
          <span className="font-mono">{integrity.headHash?.slice(0, 12) ?? '—'}</span>
          {integrity.lastAnchorAt
            ? ` · last external anchor ${new Date(integrity.lastAnchorAt).toLocaleString()}`
            : ' · not externally anchored yet'}
        </div>
      )}
    </div>
  )
}
