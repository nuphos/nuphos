import { useCallback, useEffect } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { PROVIDER_LABEL } from '../../lib/monitoringWatch'
import { readSwrCache, writeSwrCache } from '../../lib/swrCache'
import { useResetOnKey } from '../useResetOnKey'

import { POLL_INTERVAL_MS } from './constants'

import type { MonitoringOverview, MonitoringOverviewRow } from '../../types'
import type { Dispatch, SetStateAction } from 'react'

type Params = {
  teamId: string
  cacheKey: string
  refreshKey?: number
  onCount?: (count: number) => void
  onLoading?: (loading: boolean) => void
  setOverview: Dispatch<SetStateAction<MonitoringOverview | null>>
  setLoading: Dispatch<SetStateAction<boolean>>
}

export function useMonitoringOverviewSync({
  teamId,
  cacheKey,
  refreshKey,
  onCount,
  onLoading,
  setOverview,
  setLoading,
}: Params) {
  const load = useCallback(() => {
    onLoading?.(true)
    api
      .atlasGetMonitoringOverview(teamId)
      .then((next) => {
        setOverview(next)
        writeSwrCache(cacheKey, next)
        onCount?.(next.rows.length)
      })
      .catch((err: unknown) => {
        // With a snapshot on screen a failed refresh must not nuke visible
        // data — surface the error and keep showing what we have.
        toast.apiError('Failed to refresh monitoring overview', err)
      })
      .finally(() => {
        setLoading(false)
        onLoading?.(false)
      })
  }, [teamId, cacheKey, onCount, onLoading, setOverview, setLoading])

  // Cold start shows the skeleton; a refresh that already has a cached snapshot
  // keeps it on screen. Flipped during render because both loads below are
  // effect-driven, and the poll never flips it at all.
  useResetOnKey(`${teamId}|${String(refreshKey)}`, () => {
    if (readSwrCache<MonitoringOverview>(cacheKey) === undefined) setLoading(true)
  })

  useEffect(() => {
    load()
  }, [load, refreshKey])

  useEffect(() => {
    const handle = setInterval(() => load(), POLL_INTERVAL_MS)

    return () => clearInterval(handle)
  }, [load])

  // Deletion routes by provider/kind: BS monitors and heartbeats go through
  // the BYOS endpoints; Grafana alert rules go through the authenticated
  // proxy's provisioning API (only Grafana-managed rules carry a real uid —
  // synthesized fallback ids contain '/' and can't be deleted here).
  const deleteRow = useCallback(
    async (row: MonitoringOverviewRow) => {
      try {
        if (row.provider === 'betterstack' && row.kind === 'monitor') {
          await api.atlasDeleteBetterStackMonitor(teamId, row.integrationId, row.providerResourceId)
        } else if (row.provider === 'betterstack' && row.kind === 'heartbeat') {
          await api.atlasDeleteBetterStackHeartbeat(
            teamId,
            row.integrationId,
            row.providerResourceId,
          )
        } else if (row.provider === 'grafana' && row.kind === 'alert-rule') {
          await api.atlasGrafanaProxy(
            teamId,
            row.integrationId,
            'DELETE',
            `/api/v1/provisioning/alert-rules/${encodeURIComponent(row.providerResourceId)}`,
          )
        } else {
          throw new Error(`Deleting ${row.provider} ${row.kind} is not supported`)
        }
        setOverview((prev) => {
          if (!prev) return prev
          const next = {
            ...prev,
            rows: prev.rows.filter(
              (r) =>
                !(
                  r.provider === row.provider &&
                  r.integrationId === row.integrationId &&
                  r.providerResourceId === row.providerResourceId
                ),
            ),
          }

          writeSwrCache(cacheKey, next)
          onCount?.(next.rows.length)

          return next
        })
        toast.success('Deleted', `${row.name} removed from ${PROVIDER_LABEL[row.provider]}`)
      } catch (err) {
        toast.apiError('Failed to delete', err)
      }
    },
    [teamId, cacheKey, onCount, setOverview],
  )

  return { deleteRow }
}
