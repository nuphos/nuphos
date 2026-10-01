import clsx from 'clsx'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { Age } from '../../components/Age'
import { useRequiredKubeContext } from '../../hooks/useKubeContext'
import { useResetOnKey } from '../useResetOnKey'

import type { DetailTarget } from './target'
import type { EventItem } from '../../types'

export function EventsTab({ target, refreshKey }: { target: DetailTarget; refreshKey: number }) {
  const context = useRequiredKubeContext()
  const [events, setEvents] = useState<EventItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useResetOnKey(
    [
      context,
      target.kind,
      target.namespace ?? '',
      target.name,
      target.resourceKind ?? '',
      target.apiVersion ?? '',
      target.uid ?? '',
    ].join('\0'),
    () => {
      setLoading(true)
      setError(null)
    },
  )

  useEffect(() => {
    let cancelled = false

    api
      .listEvents(
        context,
        target.namespace,
        target.resourceKind ?? target.kind,
        target.name,
        target.apiVersion ?? null,
        target.uid ?? null,
      )
      .then((e) => {
        if (cancelled) return
        setError(null)
        setEvents(e)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(String(e))
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [
    context,
    target.kind,
    target.namespace,
    target.name,
    target.resourceKind,
    target.apiVersion,
    target.uid,
    refreshKey,
  ])

  if (error) return <div className="p-6 text-error text-[13px]">{error}</div>
  if (loading) return <div className="p-6 text-tertiary text-[13px]">Loading…</div>

  return (
    <div className="p-6">
      {events.length === 0 ? (
        <div className="text-tertiary text-[13px]">No events</div>
      ) : (
        <div className="space-y-2">
          {events.map((e, i) => (
            <div
              key={
                e.uid ??
                `${e.namespace}/${e.kind}/${e.name}/${e.reason}/${String(e.timestamp ?? i)}`
              }
              className="bg-zGray-900 border border-zGray-800 rounded-md px-4 py-3"
            >
              <div className="flex items-center gap-2 text-[12.5px]">
                <span
                  className={clsx(
                    'px-1.5 py-0.5 rounded text-[11px]',
                    e.type_ === 'Warning'
                      ? 'bg-error/15 text-error'
                      : 'bg-zGray-800 text-secondary',
                  )}
                >
                  {e.type_ || 'Normal'}
                </span>
                <span className="text-main font-medium">{e.reason}</span>
                <span className="text-tertiary">·</span>
                <span className="text-tertiary">
                  <Age value={e.timestamp} />
                </span>
                {e.count > 1 && <span className="text-tertiary">×{e.count}</span>}
              </div>
              <div className="text-[12.5px] text-secondary mt-1">{e.message}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
