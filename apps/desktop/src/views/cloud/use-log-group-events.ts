import { useCallback, useEffect, useRef, useState } from 'react'

import { useReportLoading } from '../../components/useReportLoading'

import { LIVE_TAIL_BUFFER, LIVE_TAIL_INTERVAL_MS, lastEventMs, sortEventsByTs } from './log-helpers'
import { applyFilter } from './shared'

import type {
  AwsLogEvent,
  AwsLogGroup,
  AwsLogGroupEvents,
  AwsLogSearchOptions,
  AwsLogSearchResult,
  AwsLogStream,
  AwsLogStreamListing,
} from '../../types'
import type { FormEvent } from 'react'

export function useLogGroupEvents(
  group: AwsLogGroup,
  loadEvents: (group: AwsLogGroup) => Promise<AwsLogGroupEvents>,
  searchEvents:
    ((group: AwsLogGroup, options: AwsLogSearchOptions) => Promise<AwsLogSearchResult>) | undefined,
  listStreams:
    ((group: AwsLogGroup, nextToken?: string) => Promise<AwsLogStreamListing>) | undefined,
  onCount: (n: number) => void,
  onLoading: ((loading: boolean) => void) | undefined,
  filter: string,
  refreshKey: number,
) {
  const [events, setEvents] = useState<AwsLogEvent[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [copied, setCopied] = useState(false)
  // null = merged tail of the latest streams; a number = FilterLogEvents window.
  const [rangeMinutes, setRangeMinutes] = useState<number | null>(null)
  const [patternInput, setPatternInput] = useState('')
  const [pattern, setPattern] = useState('')
  const [streamFilter, setStreamFilter] = useState('')
  const [streams, setStreams] = useState<AwsLogStream[]>([])
  const [nextToken, setNextToken] = useState<string | null>(null)
  const [paging, setPaging] = useState(false)
  const [live, setLive] = useState(false)
  const copyResetRef = useRef<number | undefined>(undefined)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const requestGenRef = useRef(0)
  const lastEventMsRef = useRef(0)
  const stickToBottomRef = useRef(true)
  const loadEventsRef = useRef(loadEvents)
  const searchEventsRef = useRef(searchEvents)
  const listStreamsRef = useRef(listStreams)
  const groupRef = useRef(group)
  const liveRef = useRef(live)

  useEffect(() => {
    loadEventsRef.current = loadEvents
    searchEventsRef.current = searchEvents
    listStreamsRef.current = listStreams
    groupRef.current = group
    liveRef.current = live
  })
  useReportLoading(loading, onLoading)

  const searchMode = !!searchEvents && (rangeMinutes != null || !!pattern || !!streamFilter)

  useEffect(() => () => window.clearTimeout(copyResetRef.current), [])

  // Stream list for the scope dropdown — one cheap DescribeLogStreams call.
  useEffect(() => {
    const load = listStreamsRef.current

    if (!load) return
    let cancelled = false

    load(groupRef.current)
      .then((r) => {
        if (!cancelled) setStreams(r.streams)
      })
      .catch(() => {
        // Stream scoping is an optional affordance; the dropdown just stays empty.
      })

    return () => {
      cancelled = true
    }
  }, [group.name, group.region])

  // Key the fetch off the group's identity fields, not the object reference —
  // callers (e.g. the Lambda detail view) construct the group inline each
  // render, and an object dep would re-fire on every setState here, looping
  // fetch → state change → new object → fetch forever.
  useEffect(() => {
    if (liveRef.current) return
    const gen = ++requestGenRef.current

    setLoading(true)
    setErrorMessage(null)
    setNextToken(null)
    stickToBottomRef.current = true
    const g = groupRef.current
    const search = searchEventsRef.current
    const useSearch = !!search && (rangeMinutes != null || !!pattern || !!streamFilter)
    const run = useSearch
      ? search!(g, {
          pattern: pattern || undefined,
          startTime: Date.now() - (rangeMinutes ?? 60) * 60_000,
          stream: streamFilter || undefined,
        }).then((r) => ({ events: sortEventsByTs(r.events), nextToken: r.nextToken }))
      : loadEventsRef.current(g).then((r) => ({
          events: r.events,
          nextToken: null as string | null,
        }))

    run
      .then((r) => {
        if (requestGenRef.current !== gen) return
        setEvents(r.events)
        setNextToken(r.nextToken)
        lastEventMsRef.current = lastEventMs(r.events)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (requestGenRef.current !== gen) return
        setErrorMessage(String(e instanceof Error ? e.message : e))
        setLoading(false)
      })
  }, [group.name, group.region, reloadTick, refreshKey, rangeMinutes, pattern, streamFilter])

  const loadMore = useCallback(() => {
    const search = searchEventsRef.current

    if (!search || !nextToken || paging) return
    const gen = requestGenRef.current

    setPaging(true)
    stickToBottomRef.current = false
    search(groupRef.current, {
      pattern: pattern || undefined,
      startTime: Date.now() - (rangeMinutes ?? 60) * 60_000,
      stream: streamFilter || undefined,
      nextToken,
    })
      .then((r) => {
        if (requestGenRef.current !== gen) return
        setEvents((prev) => sortEventsByTs([...(prev ?? []), ...r.events]))
        setNextToken(r.nextToken)
        setPaging(false)
      })
      .catch((e: unknown) => {
        if (requestGenRef.current !== gen) return
        setErrorMessage(String(e instanceof Error ? e.message : e))
        setPaging(false)
      })
  }, [nextToken, paging, pattern, rangeMinutes, streamFilter])

  // Opt-in live tail: poll FilterLogEvents forward from the newest seen event.
  useEffect(() => {
    const search = searchEventsRef.current

    if (!live || !search) return
    let cancelled = false
    let inFlight = false
    const tick = async () => {
      if (cancelled || inFlight) return
      inFlight = true
      try {
        const fresh: AwsLogEvent[] = []
        let token: string | undefined
        const start = lastEventMsRef.current > 0 ? lastEventMsRef.current + 1 : Date.now() - 30_000

        do {
          const r = await search(groupRef.current, {
            pattern: pattern || undefined,
            stream: streamFilter || undefined,
            startTime: start,
            nextToken: token,
          })

          fresh.push(...r.events)
          token = r.nextToken ?? undefined
          if (cancelled) break
        } while (token && fresh.length < 2000)
        if (cancelled || fresh.length === 0) return
        const sorted = sortEventsByTs(fresh)

        lastEventMsRef.current = Math.max(lastEventMsRef.current, lastEventMs(sorted))
        stickToBottomRef.current = true
        setEvents((prev) => {
          const merged = [...(prev ?? []), ...sorted]

          return merged.length > LIVE_TAIL_BUFFER ? merged.slice(-LIVE_TAIL_BUFFER) : merged
        })
      } catch {
        // Transient polling failures are invisible by design; the next tick retries.
      } finally {
        inFlight = false
      }
    }

    void tick()
    const timer = window.setInterval(() => void tick(), LIVE_TAIL_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [live, pattern, streamFilter, group.name, group.region])

  const filtered = applyFilter(events ?? [], filter, (e) => `${e.message} ${e.logStreamName}`)

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  // Logs read bottom-up: jump to the latest entries when a load or live batch
  // lands (but not when paging older/newer pages into place).
  useEffect(() => {
    if (loading || !scrollRef.current || !stickToBottomRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [loading, events])

  const copyAll = () => {
    if (!events || events.length === 0) return
    const text = events
      .map((e) => `${e.timestamp ?? ''}\t${e.message.replace(/\n$/, '')}`)
      .join('\n')

    void navigator.clipboard.writeText(text)
    setCopied(true)
    window.clearTimeout(copyResetRef.current)
    copyResetRef.current = window.setTimeout(() => setCopied(false), 1500)
  }

  const applyPattern = (e: FormEvent) => {
    e.preventDefault()
    setPattern(patternInput.trim())
  }

  const resetToTail = () => {
    setRangeMinutes(null)
    setPattern('')
    setPatternInput('')
    setStreamFilter('')
    setLive(false)
  }

  return {
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
  }
}
