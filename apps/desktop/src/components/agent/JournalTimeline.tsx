import clsx from 'clsx'
import { Terminal } from 'lucide-react'
import { useMemo } from 'react'

import {
  formatJournalTs,
  formatJournalClock,
  formatRelativeJournalTs,
  groupJournalEvents,
  journalEventChatTarget,
  journalEventIcon,
} from '../../lib/journalEvent'

import { JournalEventBody, PairedToolBody } from './JournalEventBody'

import type { AgentJournalEvent } from '../../api'
import type { JournalChatTarget } from '../../lib/journalEvent'

/**
 * AWS-investigation-timeline style rendering: a left gutter of
 * relative offsets (+26s) from the turn's start, one scannable row per
 * intent/result pair or message, details folded. Row click deep-links into
 * the conversation (the transcript owns full content; the journal owns the
 * evidence: verification marks, redactions, trust levels, missing results).
 */
export function JournalTimeline({
  events,
  sealedThrough,
  truncated,
  onLocateInChat,
}: {
  events: AgentJournalEvent[]
  sealedThrough: number
  /** Backend page cut — outcome claims for tail intents would be guesses. */
  truncated: boolean
  onLocateInChat?: (target: JournalChatTarget) => void
}) {
  const items = useMemo(() => groupJournalEvents(events, { truncated }), [events, truncated])
  // Each row's relative clock is measured from the most recent turn marker
  // above it, so resolve those bases in one pass before rendering.
  const turnBases: string[] = []
  let turnBaseTs = events[0]?.ts ?? ''

  for (const item of items) {
    if (item.kind === 'turn') turnBaseTs = item.event.ts
    turnBases.push(turnBaseTs)
  }

  return (
    <ol className="space-y-0">
      {items.map((item, index) => {
        if (item.kind === 'turn') {
          const payload = (item.event.payload ?? {}) as Record<string, unknown>

          return (
            <li key={item.event.eventId} className="flex items-center gap-2 pb-3 pt-1.5">
              <div className="h-px flex-1 bg-zGray-800" />
              <span className="flex-shrink-0 text-[10px] uppercase tracking-wider text-tertiary">
                turn · {formatJournalTs(item.event.ts)}
                {typeof payload.messageCount === 'number'
                  ? ` · ${String(payload.messageCount)} msgs in context`
                  : ''}
              </span>
              <div className="h-px flex-1 bg-zGray-800" />
            </li>
          )
        }
        const anchorEvent = item.kind === 'tool' ? (item.intent ?? item.result) : item.event

        if (!anchorEvent) return null
        const target = journalEventChatTarget(anchorEvent)
        // A paired row is sealed only when its LAST event is — the intent may
        // be under the seal while the displayed result is still mutable.
        const sealSeq =
          item.kind === 'tool'
            ? Math.max(item.intent?.seq ?? 0, item.result?.seq ?? 0)
            : anchorEvent.seq
        const sealed = sealSeq > 0 && sealSeq <= sealedThrough
        const Icon = item.kind === 'tool' ? Terminal : journalEventIcon(anchorEvent.type)

        return (
          <li
            key={anchorEvent.eventId}
            data-anchor-tool={target?.toolCallId}
            data-anchor-message={target?.messageId}
            onClick={target && onLocateInChat ? () => onLocateInChat(target) : undefined}
            className={clsx(
              'relative flex gap-2.5 rounded-md px-1 pb-3.5 transition-colors last:pb-0',
              target && onLocateInChat && 'hover:bg-zGray-800/40',
            )}
            title={`#${String(anchorEvent.seq)} · ${formatJournalTs(anchorEvent.ts)}${
              target && onLocateInChat ? ' — click to show in conversation' : ''
            }`}
          >
            {/* Both clocks (0706 sync #3): absolute for correlating with
                external systems, the turn-relative offset for step pacing. */}
            <span className="w-[52px] flex-shrink-0 pt-0.5 text-right">
              <span className="block text-[10px] leading-3.5 tabular-nums text-tertiary">
                {formatJournalClock(anchorEvent.ts)}
              </span>
              <span className="block text-[9px] leading-3 tabular-nums text-tertiary/60">
                {formatRelativeJournalTs(anchorEvent.ts, turnBases[index])}
              </span>
            </span>
            <div className="flex flex-col items-center pt-0.5">
              <Icon className="h-3.5 w-3.5 flex-shrink-0 text-tertiary" strokeWidth={1.8} />
              <div className="mt-1 w-px flex-1 bg-zGray-800" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              {sealed && (
                <span className="float-right text-[9px] uppercase tracking-wider text-emerald-500/80">
                  sealed
                </span>
              )}
              {item.kind === 'tool' ? (
                <PairedToolBody
                  intent={item.intent}
                  result={item.result}
                  mayBeRunning={item.mayBeRunning}
                  tailTruncated={item.tailTruncated}
                  reasoning={item.reasoning}
                />
              ) : (
                <JournalEventBody
                  event={item.event}
                  reasoningOverride={
                    item.kind === 'message' && item.event.type === 'assistant_message'
                      ? (item.trailingReasoning ?? '')
                      : undefined
                  }
                />
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
