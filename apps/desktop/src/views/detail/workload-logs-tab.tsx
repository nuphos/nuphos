import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { useRequiredKubeContext } from '../../hooks/useKubeContext'
import { filterLogLines } from '../../lib/logView'
import { useResetOnKey } from '../useResetOnKey'

import {
  LOG_TIME_MODE_CAP,
  LogPreviousToggle,
  LogRangeSelector,
  LogViewControls,
} from './log-controls'
import { WorkloadLogBody } from './workload-log-body'
import { buildPodColor, mergeLogRows } from './workload-log-lines'
import { FollowTailButton, LogStreamStatus } from './workload-log-model'

import type { LogRangeMode } from './log-controls'
import type { LogRow } from './workload-log-lines'
import type { TimestampMode } from '../../lib/logView'

export function WorkloadLogsTab({
  kind,
  namespace,
  name,
}: {
  kind: string
  namespace: string
  name: string
}) {
  const context = useRequiredKubeContext()
  // Render-side log row: identical to the backend's WorkloadLogLine plus a
  // monotonic id assigned at ingestion. We need the id as a stable React
  // key — the rolling cap evicts from the front, so an index-based key
  // would shift identity for every retained row whenever the buffer is
  // trimmed.
  const [lines, setLines] = useState<LogRow[]>([])
  const nextLogId = useRef(0)
  const [tailLines, setTailLines] = useState(200)
  const [rangeMode, setRangeMode] = useState<LogRangeMode>('lines')
  const [sinceSeconds, setSinceSeconds] = useState<number | null>(3600)
  // Starts true: `previous` defaults to false, so the mount-time effect below
  // always opens a follow.
  const [streaming, setStreaming] = useState(true)
  const [query, setQuery] = useState('')
  const [tsMode, setTsMode] = useState<TimestampMode>('off')
  // Show each pod's previous (terminated) instance as a one-shot snapshot.
  const [previous, setPrevious] = useState(false)
  // True while the previous-instance snapshot is being fetched (the stream path
  // uses `streaming` instead) — keeps the panel from flashing "No previous
  // logs" before the request resolves.
  const [previousLoading, setPreviousLoading] = useState(false)
  // Track stick-to-bottom in a ref (the single source of truth) so the
  // scroll-pin effect always reads the freshest value, and mirror into
  // state only for the header indicator. Writing to a ref during render
  // is OK because it's idempotent and only happens when the indicator
  // flips state — not on every line append.
  const stickRef = useRef(true)
  const [stickIndicator, setStickIndicator] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Latch used to ignore scroll events that we triggered ourselves —
  // setting `scrollTop` fires the scroll event synchronously, which would
  // otherwise immediately flip `stickRef` based on a transient measurement
  // before layout has fully settled.
  const programmaticScrollRef = useRef(false)

  useResetOnKey(
    `${context}\0${kind}\0${namespace}\0${name}\0${rangeMode}\0${String(tailLines)}\0${String(sinceSeconds ?? '')}\0${String(previous)}`,
    () => {
      setLines([])
      // Drop a stale search carried over from the previously-viewed workload (it
      // would silently hide the new lines). A tail-size change also clearing the
      // query is fine since the data reloads anyway.
      setQuery('')
      // Previous-instance logs are a historical snapshot — there's nothing to
      // follow, so the effect below fetches once instead of opening a stream.
      setStreaming(!previous)
      setPreviousLoading(previous)
    },
  )

  useEffect(() => {
    let cancelled = false

    if (previous) {
      api
        .getWorkloadPreviousLogs(context, kind, namespace, name, { tailLines })
        .then((rows) => {
          if (cancelled) return
          setLines(rows.map((l) => ({ ...l, id: nextLogId.current++ })))
          setPreviousLoading(false)
        })
        .catch((e: unknown) => {
          if (cancelled) return
          setPreviousLoading(false)
          toast.apiError('Could not load previous logs', e)
        })

      return () => {
        cancelled = true
      }
    }

    let activeSessionId: string | null = null

    const offEvent = api.onWorkloadLogEvent((evt) => {
      if (evt.sessionId !== activeSessionId) return
      if (evt.type === 'lines') {
        const ingested: LogRow[] = evt.lines.map((l) => ({
          ...l,
          id: nextLogId.current++,
        }))

        setLines((prev) => mergeLogRows(prev, ingested))
      } else if (evt.type === 'error') {
        // A session-level error means the follow has stopped — drop the
        // streaming indicator and surface the reason via toast (per CLAUDE.md),
        // matching PodLogs' failure feedback.
        setStreaming(false)
        toast.error('Log stream error', evt.message)
      } else if (evt.type === 'warning') {
        toast.error('Some container logs are unavailable', evt.message)
      } else {
        setStreaming(true)
      }
    })

    // Lines mode: follow with a fixed tail. Time mode: seed the follow with a
    // relative window, capped so a wide window can't pull an unbounded log.
    const logQuery =
      rangeMode === 'time'
        ? { tailLines: LOG_TIME_MODE_CAP, sinceSeconds: sinceSeconds ?? undefined }
        : { tailLines }

    api
      .startWorkloadLogStream(context, kind, namespace, name, logQuery)
      .then((sessionId) => {
        if (cancelled) {
          // Cancellation can race a successful start — clean up the
          // backend session so it doesn't keep a follow open with nobody
          // listening.
          void api.stopWorkloadLogStream(sessionId)

          return
        }
        activeSessionId = sessionId
      })
      .catch((e: unknown) => {
        if (cancelled) return
        // Stream never came up — drop the optimistic streaming indicator and
        // report via toast.
        setStreaming(false)
        toast.apiError('Could not start log stream', e)
      })

    return () => {
      cancelled = true
      // `streaming` is owned by the reset above, which already ran for the new
      // key by the time this cleanup fires; clearing it here would undo that.
      offEvent()
      if (activeSessionId) void api.stopWorkloadLogStream(activeSessionId)
    }
  }, [context, kind, namespace, name, rangeMode, tailLines, sinceSeconds, previous])

  // Auto-scroll to the bottom whenever new lines arrive AND the user is
  // following the tail. `useLayoutEffect` runs synchronously after DOM
  // mutations and before paint, so the user never sees a frame where the
  // new content is off-screen below the viewport.
  useLayoutEffect(() => {
    if (!stickRef.current) return
    const el = scrollRef.current

    if (!el) return
    programmaticScrollRef.current = true
    el.scrollTop = el.scrollHeight
    // Release the latch on the next frame — by then the synchronous
    // scroll event from the assignment above has fired and we don't want
    // to swallow any subsequent user scroll.
    requestAnimationFrame(() => {
      programmaticScrollRef.current = false
    })
  }, [lines])

  function onScroll() {
    if (programmaticScrollRef.current) return
    const el = scrollRef.current

    if (!el) return
    // Generous threshold — keep "sticky" if the user is within ~3 lines
    // of the bottom. Otherwise a slow stream where the user is reading
    // the last line keeps flipping out of sticky mode.
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48

    if (nearBottom !== stickRef.current) {
      stickRef.current = nearBottom
      setStickIndicator(nearBottom)
    }
  }

  // Memoized — without this, unrelated state flips (the streaming
  // indicator toggling, sticky-bottom changes) would each re-pass over
  // the entire accumulated `lines` array.
  const podColor = useMemo(() => buildPodColor(lines), [lines])

  const visible = useMemo(() => filterLogLines(lines, query, tsMode), [lines, query, tsMode])

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-2 border-b border-zGray-800 flex items-center gap-3 bg-zGray-900">
        <LogRangeSelector
          mode={rangeMode}
          onModeChange={(m) => {
            setRangeMode(m)
            // Time mode + previous is meaningless (a previous instance is
            // historical) — drop previous when switching to Time.
            if (m === 'time') setPrevious(false)
          }}
          tailLines={tailLines}
          onTailLinesChange={setTailLines}
          sinceSeconds={sinceSeconds}
          onSinceSecondsChange={setSinceSeconds}
        />
        <LogPreviousToggle
          value={previous}
          onChange={setPrevious}
          disabled={rangeMode === 'time'}
        />
        <span className="text-tertiary text-[12px]">
          {previous
            ? 'previous instance'
            : rangeMode === 'time'
              ? 'time window'
              : 'backfill / container'}
        </span>
        <div className="ml-auto flex items-center gap-3 text-[11.5px] text-tertiary">
          <LogViewControls
            query={query}
            onQueryChange={setQuery}
            tsMode={tsMode}
            onTsModeChange={setTsMode}
            exportSource={() => ({ lines: visible, includePod: true, fileBase: name })}
          />
          {!stickIndicator && (
            <FollowTailButton
              stickRef={stickRef}
              setStickIndicator={setStickIndicator}
              scrollRef={scrollRef}
              programmaticScrollRef={programmaticScrollRef}
            />
          )}
          <LogStreamStatus previous={previous} streaming={streaming} />
        </div>
      </div>
      <WorkloadLogBody
        scrollRef={scrollRef}
        onScroll={onScroll}
        previousLoading={previousLoading}
        visible={visible}
        totalLines={lines.length}
        previous={previous}
        streaming={streaming}
        tsMode={tsMode}
        podColor={podColor}
      />
    </div>
  )
}
