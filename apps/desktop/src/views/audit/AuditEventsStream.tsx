import clsx from 'clsx'
import { Container, FileClock } from 'lucide-react'

import { JournalEventBody } from '../../components/agent/JournalEventBody'
import { useReportVisibleError, VisibleErrorReporter } from '../../components/VisibleErrorReporter'
import { formatJournalTs, journalEventChatTarget, journalEventIcon } from '../../lib/journalEvent'

import { EmptyState, LoadMore, SearchScopeHint } from './AuditListChrome'
import { isRuntimeImageAuditEvent, isSkillAuditEvent, userLabel } from './shared'

import type { EventsState, SelectedJournal } from './shared'
import type { AgentAuditEvent, RuntimeImageAuditEvent, SkillAuditEvent } from '../../api'

export function AuditEventsStream({
  events,
  eventRows,
  setSelected,
  needle,
  mutationsOnly,
  loadingMore,
  loadMore,
}: {
  events: EventsState
  eventRows: AgentAuditEvent[]
  setSelected: React.Dispatch<React.SetStateAction<SelectedJournal | null>>
  needle: string
  mutationsOnly: boolean
  loadingMore: boolean
  loadMore: () => Promise<void>
}) {
  useReportVisibleError(events.kind === 'error' ? events.message : null, 'audit_events_error')

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin px-5 py-3 selectable">
        {events.kind === 'loading' ? (
          <div className="py-10 text-center text-xs text-tertiary">Loading audit events…</div>
        ) : events.kind === 'error' ? (
          <div className="py-10 text-center text-xs text-error">{events.message}</div>
        ) : eventRows.length === 0 ? (
          needle ? (
            <SearchScopeHint hasMore={Boolean(events.nextCursor)} />
          ) : (
            <EmptyState mutationsOnly={mutationsOnly} />
          )
        ) : (
          <ol className="mx-auto w-full max-w-[860px]">
            {eventRows.map((event) => {
              if (isRuntimeImageAuditEvent(event)) {
                return (
                  <RuntimeImageAuditRow
                    key={event.eventId}
                    event={event}
                    actorLabel={userLabel(events.users, event.actor.userId)}
                  />
                )
              }
              if (isSkillAuditEvent(event)) {
                return (
                  <SkillAuditRow
                    key={event.eventId}
                    event={event}
                    actorLabel={userLabel(events.users, event.actor.userId)}
                    onOpen={
                      event.mutation.conversationId
                        ? () =>
                            setSelected((current) =>
                              current?.focusEventId === event.eventId
                                ? null
                                : {
                                    sessionId: event.mutation.conversationId!,
                                    focusTarget: event.mutation.toolCallId
                                      ? { toolCallId: event.mutation.toolCallId }
                                      : null,
                                    focusEventId: event.eventId,
                                  },
                            )
                        : undefined
                    }
                  />
                )
              }
              const Icon = journalEventIcon(event.type)
              const sessionId = event.session.conversationId
              const conv = events.conversations[sessionId]

              return (
                <li
                  key={event.eventId}
                  onClick={() =>
                    // Same toggle contract as conversation rows: clicking
                    // the event the panel was opened from collapses it.
                    setSelected((current) =>
                      current?.focusEventId === event.eventId
                        ? null
                        : {
                            sessionId,
                            focusTarget: journalEventChatTarget(event),
                            focusEventId: event.eventId,
                          },
                    )
                  }
                  title="View in journal"
                  className="flex gap-3 rounded-md px-2 py-2 transition-colors hover:bg-zGray-800/40"
                >
                  <Icon
                    className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-tertiary"
                    strokeWidth={1.8}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[10px] text-tertiary">
                        {new Date(event.ts).toLocaleDateString()} {formatJournalTs(event.ts)}
                      </span>
                      <span className="truncate text-[11px] text-secondary">
                        {userLabel(events.users, event.actor.userId)}
                      </span>
                      <span className="truncate text-[11px] text-tertiary" title={conv?.title}>
                        · {conv?.title ?? sessionId.slice(0, 8)}
                      </span>
                    </div>
                    <div className="mt-0.5 space-y-1">
                      <JournalEventBody event={event} />
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </div>
      <LoadMore
        visible={events.kind === 'ready' && Boolean(events.nextCursor)}
        loading={loadingMore}
        onClick={() => void loadMore()}
      />
    </div>
  )
}

/** The runtime keeps its bound credentials across an image change, so both
 *  digests and the administrator who chose them stay on the record. */
function RuntimeImageAuditRow({
  event,
  actorLabel,
}: {
  event: RuntimeImageAuditEvent
  actorLabel: string
}) {
  return (
    <li className="flex gap-3 rounded-md px-2 py-2">
      <Container className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-sky-300" strokeWidth={1.8} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] text-tertiary">
            {new Date(event.ts).toLocaleDateString()} {formatJournalTs(event.ts)}
          </span>
          <span className="truncate text-[11px] text-secondary">{actorLabel}</span>
          <span className="truncate text-[11px] text-tertiary" title={event.resource.runtimeId}>
            · {event.resource.provider} agent · {event.resource.label}
          </span>
        </div>
        <div className="mt-0.5 text-[12px]">
          <span className="font-mono text-main">image change</span>
        </div>
        <div className="mt-1 space-y-0.5 font-mono text-[11px] text-tertiary">
          <div className="truncate" title={event.change.fromImage ?? undefined}>
            from {event.change.fromImage ?? '(none)'}
          </div>
          <div className="truncate" title={event.change.toImage}>
            to {event.change.toImage}
          </div>
        </div>
      </div>
    </li>
  )
}

function SkillAuditRow({
  event,
  actorLabel,
  onOpen,
}: {
  event: SkillAuditEvent
  actorLabel: string
  onOpen?: () => void
}) {
  const statusClass =
    event.mutation.status === 'applied'
      ? 'text-emerald-400'
      : event.mutation.status === 'failed' || event.mutation.status === 'partial'
        ? 'text-red-400'
        : 'text-tertiary'

  return (
    <li
      onClick={onOpen}
      title={onOpen ? 'View originating conversation' : undefined}
      className={clsx(
        'flex gap-3 rounded-md px-2 py-2',
        onOpen && 'transition-colors hover:bg-zGray-800/40',
      )}
    >
      <FileClock className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-violet-300" strokeWidth={1.8} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] text-tertiary">
            {new Date(event.ts).toLocaleDateString()} {formatJournalTs(event.ts)}
          </span>
          <span className="truncate text-[11px] text-secondary">{actorLabel}</span>
          <span className="truncate text-[11px] text-tertiary" title={event.resource.scope}>
            · Team skill · {event.resource.name}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
          <span className="font-mono text-main">{event.mutation.action.replaceAll('_', ' ')}</span>
          <span className={clsx('font-mono text-[11px]', statusClass)}>
            {event.mutation.status}
          </span>
          <span className="text-[11px] text-tertiary">
            via {event.mutation.source}
            {event.mutation.revision === null ? '' : ` · r${String(event.mutation.revision)}`}
          </span>
        </div>
        {event.mutation.changedKeys.length > 0 && (
          <div className="mt-1 truncate font-mono text-[11px] text-tertiary">
            {event.mutation.changedKeys.join(', ')}
          </div>
        )}
        {event.mutation.error && (
          <div className="mt-1 line-clamp-2 text-[11px] text-red-300" title={event.mutation.error}>
            <VisibleErrorReporter
              message={event.mutation.error}
              surface="skill_audit_mutation_error"
            />
            {event.mutation.error}
          </div>
        )}
      </div>
    </li>
  )
}
