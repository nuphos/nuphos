import clsx from 'clsx'

import { formatLogTimestamp } from '../../lib/logView'

import { AnsiLogText } from './ansi-log-text'

import type { LogRow } from './workload-log-lines'
import type { TimestampMode } from '../../lib/logView'
import type { RefObject, UIEventHandler } from 'react'

export function WorkloadLogBody({
  scrollRef,
  onScroll,
  previousLoading,
  visible,
  totalLines,
  previous,
  streaming,
  tsMode,
  podColor,
}: {
  scrollRef: RefObject<HTMLDivElement | null>
  onScroll: UIEventHandler<HTMLDivElement>
  previousLoading: boolean
  visible: LogRow[]
  totalLines: number
  previous: boolean
  streaming: boolean
  tsMode: TimestampMode
  podColor: (pod: string) => string
}) {
  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="flex-1 min-h-0 overflow-auto scrollbar-thin font-mono text-[11.5px] p-4 bg-zGray-950 selectable"
    >
      {previousLoading ? (
        <span className="text-tertiary">Loading previous logs…</span>
      ) : visible.length === 0 ? (
        <span className="text-tertiary">
          {totalLines > 0
            ? 'No matching lines'
            : previous
              ? 'No previous logs — no terminated instances found.'
              : streaming
                ? 'Waiting for logs…'
                : 'No logs'}
        </span>
      ) : (
        visible.map((l) => (
          <div key={l.id} className="whitespace-pre-wrap leading-tight">
            {tsMode !== 'off' && (
              <span className="text-tertiary mr-2">{formatLogTimestamp(l.timestamp, tsMode)}</span>
            )}
            <span className={clsx(podColor(l.pod), 'mr-2')}>
              [{l.pod}/{l.container}]
            </span>
            <AnsiLogText message={l.message} />
          </div>
        ))
      )}
    </div>
  )
}
