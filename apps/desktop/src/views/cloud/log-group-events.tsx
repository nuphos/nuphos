import { faCheck, faCopy, faArrowLeft, faRotateRight } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Globe } from 'lucide-react'

import { api } from '../../api'
import { AppSelect } from '../../components/ui/select'

import { ErrorBlock } from './ErrorBlock'
import { LOG_RANGE_OPTIONS, cloudWatchLogGroupUrl, formatLogTimestamp } from './log-helpers'
import { useLogGroupEvents } from './use-log-group-events'

import type {
  AwsLogGroup,
  AwsLogGroupEvents,
  AwsLogSearchOptions,
  AwsLogSearchResult,
  AwsLogStreamListing,
} from '../../types'

// Log viewer for one log group. Default is a recent-events tail; picking a
// time range, filter pattern, or stream switches to server-side
// FilterLogEvents search with forward pagination. No background polling —
// reload is manual, except the explicit opt-in Live mode.
export function LogGroupEventsView({
  group,
  loadEvents,
  searchEvents,
  listStreams,
  onBack,
  onCount,
  onLoading,
  filter,
  refreshKey,
}: {
  group: AwsLogGroup
  loadEvents: (group: AwsLogGroup) => Promise<AwsLogGroupEvents>
  searchEvents?: (group: AwsLogGroup, options: AwsLogSearchOptions) => Promise<AwsLogSearchResult>
  listStreams?: (group: AwsLogGroup, nextToken?: string) => Promise<AwsLogStreamListing>
  /** Omit to embed inside another detail view (hides the back button). */
  onBack?: () => void
  onCount: (n: number) => void
  onLoading?: (loading: boolean) => void
  filter: string
  refreshKey: number
}) {
  const {
    events,
    loading,
    errorMessage,
    copied,
    rangeMinutes,
    setRangeMinutes,
    patternInput,
    setPatternInput,
    pattern,
    streamFilter,
    setStreamFilter,
    streams,
    nextToken,
    paging,
    live,
    setLive,
    scrollRef,
    searchMode,
    filtered,
    setReloadTick,
    loadMore,
    copyAll,
    applyPattern,
    resetToTail,
  } = useLogGroupEvents(
    group,
    loadEvents,
    searchEvents,
    listStreams,
    onCount,
    onLoading,
    filter,
    refreshKey,
  )

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2 border-b border-zGray-800 flex items-center gap-3 text-[11.5px]">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1 text-tertiary hover:text-main shrink-0"
            title="Back to log groups"
          >
            <FontAwesomeIcon icon={faArrowLeft} className="w-3.5 h-3.5" />
          </button>
        )}
        <span className="font-mono text-secondary truncate" title={group.name}>
          {group.name}
        </span>
        <span className="text-secondary px-1.5 py-0.5 rounded bg-zGray-800/60 shrink-0">
          {group.region}
        </span>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setReloadTick((t) => t + 1)}
            disabled={live}
            className="inline-flex items-center gap-1 text-tertiary hover:text-main disabled:opacity-50"
            title={live ? 'Live tail is appending automatically' : 'Reload events'}
          >
            <FontAwesomeIcon
              icon={faRotateRight}
              className={`w-3.5 h-3.5${loading ? ' animate-spin' : ''}`}
            />
            Reload
          </button>
          <button
            type="button"
            onClick={copyAll}
            disabled={!events || events.length === 0}
            className="inline-flex items-center gap-1 text-tertiary hover:text-main disabled:opacity-50"
            title="Copy all loaded events"
          >
            <FontAwesomeIcon icon={copied ? faCheck : faCopy} className="w-3.5 h-3.5" />
            {copied ? 'Copied' : 'Copy all'}
          </button>
          <button
            type="button"
            onClick={() => void api.appOpenExternal(cloudWatchLogGroupUrl(group))}
            className="inline-flex items-center gap-1 text-tertiary hover:text-main"
          >
            <Globe className="w-3.5 h-3.5" strokeWidth={1.8} />
            AWS console
          </button>
        </div>
      </div>

      {searchEvents && (
        <div className="px-4 py-1.5 border-b border-zGray-800 flex items-center gap-2 text-[11.5px]">
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onPointerDown={(event) => {
                if (event.button !== 0) return
                resetToTail()
              }}
              onClick={(event) => {
                // Keyboard only — pointer presses already fired at pointerdown.
                if (event.detail !== 0) return
                resetToTail()
              }}
              className={`h-6 px-2 rounded text-[11.5px] font-medium ${
                !searchMode
                  ? 'bg-zViolet-accent/15 text-zViolet-accent'
                  : 'text-tertiary hover:text-main hover:bg-zGray-850'
              }`}
              title="Latest events across the most recent streams"
            >
              Tail
            </button>
            {LOG_RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.minutes}
                type="button"
                onPointerDown={(event) => {
                  if (event.button !== 0) return
                  setRangeMinutes(opt.minutes)
                }}
                onClick={(event) => {
                  if (event.detail !== 0) return
                  setRangeMinutes(opt.minutes)
                }}
                className={`h-6 px-2 rounded text-[11.5px] font-medium ${
                  rangeMinutes === opt.minutes
                    ? 'bg-zViolet-accent/15 text-zViolet-accent'
                    : 'text-tertiary hover:text-main hover:bg-zGray-850'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <form onSubmit={applyPattern} className="flex-1 min-w-0">
            <input
              value={patternInput}
              onChange={(e) => setPatternInput(e.target.value)}
              placeholder={'Filter pattern — e.g. ERROR, "timed out", { $.level = "error" }'}
              className="w-full h-6 px-2 rounded bg-field border border-zGray-800 text-[11.5px] font-mono text-secondary placeholder:text-tertiary/70 focus:outline-none focus:border-zViolet-accent/60"
            />
          </form>
          {streams.length > 0 && (
            <AppSelect
              value={streamFilter}
              onValueChange={setStreamFilter}
              triggerClassName="h-6 border-zGray-800 px-2 text-[11.5px] max-w-[220px]"
              options={[
                { value: '', label: 'All streams' },
                ...streams.map((s) => ({ value: s.name, label: s.name })),
              ]}
            />
          )}
          <button
            type="button"
            onClick={() => setLive((v) => !v)}
            className={`h-6 px-2 rounded text-[11.5px] font-medium inline-flex items-center gap-1.5 shrink-0 ${
              live
                ? 'bg-[#73bf69]/15 text-[#73bf69]'
                : 'text-tertiary hover:text-main hover:bg-zGray-850'
            }`}
            title={live ? 'Stop live tail' : 'Poll for new events every few seconds'}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${live ? 'bg-[#73bf69] animate-pulse' : 'bg-zGray-600'}`}
            />
            Live
          </button>
        </div>
      )}

      {errorMessage ? (
        <ErrorBlock message={errorMessage} />
      ) : loading && events === null ? (
        <div className="flex-1 flex items-center justify-center text-sm text-tertiary">
          Loading events...
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-auto scrollbar-thin font-mono text-[11.5px] leading-[1.6]"
        >
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-tertiary font-sans text-[12.5px]">
              {filter
                ? `No events matching "${filter}"`
                : pattern
                  ? `No events matching pattern ${pattern} in this range.`
                  : 'No recent events in this log group.'}
            </div>
          ) : (
            <div className="px-4 py-2">
              {filtered.map((e, i) => (
                <div key={i} className="flex gap-3 hover:bg-zGray-900/60">
                  <span className="text-tertiary shrink-0 tabular-nums" title={e.logStreamName}>
                    {formatLogTimestamp(e.timestamp)}
                  </span>
                  <span className="text-secondary whitespace-pre-wrap break-all">
                    {e.message.replace(/\n$/, '')}
                  </span>
                </div>
              ))}
              {nextToken && !live && (
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={paging}
                  className="my-2 h-6 px-2.5 rounded bg-zGray-850 hover:bg-zGray-800 text-secondary hover:text-main font-sans text-[11.5px] disabled:opacity-50"
                >
                  {paging ? 'Loading…' : 'Load more'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
