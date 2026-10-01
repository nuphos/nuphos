import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { useRequiredKubeContext } from '../../hooks/useKubeContext'
import { filterLogLines, formatLogTimestamp } from '../../lib/logView'
import { useResetOnKey } from '../useResetOnKey'

import { AnsiLogText } from './ansi-log-text'
import { allPodContainers, containerDisplayName } from './pod-containers'
import {
  LOG_TIME_MODE_CAP,
  LogPreviousToggle,
  LogRangeSelector,
  LogViewControls,
} from './log-controls'

import type { LogRangeMode } from './log-controls'
import type { TimestampMode } from '../../lib/logView'
import type { WorkloadLogLine } from '../../types'

type LogRow = WorkloadLogLine & { id: number }

export function PodLogs({ namespace, name }: { namespace: string; name: string }) {
  const context = useRequiredKubeContext()
  const [logs, setLogs] = useState<LogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [container, setContainer] = useState<string | null>(null)
  const [containers, setContainers] = useState<{ name: string; label: string }[]>([])
  const [query, setQuery] = useState('')
  const [tsMode, setTsMode] = useState<TimestampMode>('off')
  // Show the previous (terminated) container instance's logs — a one-shot
  // snapshot for post-crash triage (kubectl logs --previous).
  const [previous, setPrevious] = useState(false)
  const [tailLines, setTailLines] = useState(200)
  const [rangeMode, setRangeMode] = useState<LogRangeMode>('lines')
  const [sinceSeconds, setSinceSeconds] = useState<number | null>(3600)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Reset the selection during the render that switches pods so a stale
  // container name from the previous pod can't sneak into the next getPodLogs
  // call.
  useResetOnKey(`${context}\0${namespace}\0${name}`, () => {
    setContainers([])
    setContainer(null)
    // New pod → drop any leftover search so a query from the previous resource
    // doesn't silently hide the new pod's lines. Timestamp mode is a display
    // preference and intentionally persists.
    setQuery('')
    // New pod → default back to the live (current) instance.
    setPrevious(false)
  })

  useEffect(() => {
    // The cancel flag drops a late getPodDetail response if the user has
    // already navigated to another pod / cluster.
    let cancelled = false

    api
      .getPodDetail(context, namespace, name)
      .then((d) => {
        if (cancelled) return
        const all = allPodContainers(d).map((c) => ({
          name: c.name,
          label: containerDisplayName(c),
        }))

        setContainers(all)
        setContainer(all[0]?.name ?? null)
        // No containers → the log effect would early-return forever; clear loading.
        if (all.length === 0) setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        // Discovery failed → no container to load, and the log effect early-
        // returns while container is null. Clear loading + report so the panel
        // doesn't sit in a perpetual "Loading…". Mirrors PodTerminalTab.
        setLoading(false)
        toast.apiError('Could not load pod containers', e)
      })

    return () => {
      cancelled = true
    }
  }, [context, namespace, name])

  // Clear the previous container's lines up-front so a failed or still-pending
  // switch can't leave stale logs on screen (F1).
  useResetOnKey(
    `${context}\0${namespace}\0${name}\0${container ?? ''}\0${rangeMode}\0${String(tailLines)}\0${String(sinceSeconds ?? '')}\0${String(previous)}`,
    () => {
      setLoading(true)
      setLogs([])
    },
  )

  useEffect(() => {
    // Wait for container discovery: getPodLogs with a null container rejects on
    // multi-container pods and would flash a false error toast (F2).
    if (!container) return
    let cancelled = false
    // Lines mode: a fixed line count (+ optional previous instance). Time mode:
    // a relative window, capped so a wide window can't pull an unbounded log.
    const logQuery =
      rangeMode === 'time'
        ? { tailLines: LOG_TIME_MODE_CAP, sinceSeconds: sinceSeconds ?? undefined }
        : { tailLines, previous }

    api
      .getPodLogs(context, namespace, name, container, logQuery)
      .then((rows) => {
        if (cancelled) return
        // Assign a stable id per row so search-filtering doesn't remount rows
        // (key off identity, not array index).
        setLogs(rows.map((r, i) => ({ ...r, id: i })))
        setLoading(false)
        requestAnimationFrame(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight
          }
        })
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setLoading(false)
        // A "no previous instance" miss comes back as [] from the main process,
        // so anything reaching here is a real failure. Per CLAUDE.md: toast.
        toast.apiError('Could not load logs', e)
      })

    return () => {
      cancelled = true
    }
  }, [context, namespace, name, container, rangeMode, tailLines, sinceSeconds, previous])

  const visible = useMemo(() => filterLogLines(logs, query, tsMode), [logs, query, tsMode])

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-2 border-b border-zGray-800 flex items-center gap-2 bg-zGray-900">
        <span className="text-[11.5px] text-tertiary uppercase tracking-wider">Container:</span>
        {containers.map((c) => (
          <button
            key={c.name}
            onClick={() => setContainer(c.name)}
            className={clsx(
              'px-2 py-1 rounded text-[12px]',
              container === c.name
                ? 'bg-zViolet-500/20 text-zViolet-accent'
                : 'text-secondary hover:bg-zGray-800',
            )}
          >
            {c.label}
          </button>
        ))}
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
        <div className="ml-auto flex items-center gap-2">
          <LogViewControls
            query={query}
            onQueryChange={setQuery}
            tsMode={tsMode}
            onTsModeChange={setTsMode}
            exportSource={() => ({ lines: visible, includePod: false, fileBase: name })}
          />
        </div>
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto scrollbar-thin font-mono text-[11.5px] p-4 bg-zGray-950 selectable"
      >
        {loading ? (
          <span className="text-tertiary">Loading…</span>
        ) : visible.length === 0 ? (
          <span className="text-tertiary">
            {query
              ? 'No matching lines'
              : previous
                ? 'No previous logs — this container has not restarted.'
                : 'No logs'}
          </span>
        ) : (
          visible.map((l) => (
            <div key={l.id} className="whitespace-pre-wrap leading-tight">
              {tsMode !== 'off' && (
                <span className="text-tertiary mr-2">
                  {formatLogTimestamp(l.timestamp, tsMode)}
                </span>
              )}
              <AnsiLogText message={l.message} />
            </div>
          ))
        )}
      </div>
    </div>
  )
}
