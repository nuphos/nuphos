import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { api, parseAtlasError } from '../api'

import { CapabilityPanel, EmptyMonitoring, MetricChart } from './mongo/MonitoringCharts'
import { toChartRow } from './mongo/monitoringFormat'
import { MonitoringSummaryHeader } from './mongo/MonitoringSummaryHeader'

import type { DatabaseConnection, MongoMonitoringHistory } from '../types'

type Props = {
  teamId: string
  connection: DatabaseConnection
}

export function MongoDatabaseMonitoring({ teamId, connection }: Props) {
  const [history, setHistory] = useState<MongoMonitoringHistory | null>(null)
  const [rangeMinutes, setRangeMinutes] = useState(60)
  const [intervalSeconds, setIntervalSeconds] = useState(30)
  const [paused, setPaused] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sampling, setSampling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(
    async (collect: boolean) => {
      setError(null)
      if (collect) setSampling(true)
      try {
        if (collect) await api.atlasSampleMongoMonitoring(teamId, connection.id)
        setHistory(await api.atlasGetMongoMonitoringHistory(teamId, connection.id, rangeMinutes))
      } catch (cause) {
        setError(parseAtlasError(cause).message)
        try {
          setHistory(await api.atlasGetMongoMonitoringHistory(teamId, connection.id, rangeMinutes))
        } catch {
          // Keep the useful sampling error and any previously rendered history.
        }
      } finally {
        setLoading(false)
        setSampling(false)
      }
    },
    [connection.id, rangeMinutes, teamId],
  )

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(!paused), 0)

    if (paused) return () => window.clearTimeout(initial)
    const timer = window.setInterval(() => void refresh(true), intervalSeconds * 1_000)

    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [intervalSeconds, paused, refresh])

  const samples = useMemo(() => history?.samples ?? [], [history?.samples])
  const latest = samples.at(-1) ?? null
  const isReplicaSet = latest?.deploymentType === 'replica-set'
  const chartRows = useMemo(() => samples.map(toChartRow), [samples])

  return (
    <div className="space-y-4">
      <MonitoringSummaryHeader
        latest={latest}
        paused={paused}
        sampling={sampling}
        error={error}
        rangeMinutes={rangeMinutes}
        intervalSeconds={intervalSeconds}
        onRangeChange={setRangeMinutes}
        onIntervalChange={setIntervalSeconds}
        onTogglePause={() => setPaused((value) => !value)}
        onRefresh={() => void refresh(true)}
      />

      {loading && !history ? (
        <div className="flex min-h-64 items-center justify-center rounded-xl border border-zGray-800 text-[12px] text-tertiary">
          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          Collecting the first sample…
        </div>
      ) : samples.length === 0 ? (
        <EmptyMonitoring />
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            <MetricChart
              title="Operations per second"
              data={chartRows}
              unit="/s"
              lines={[
                ['query', 'Queries'],
                ['command', 'Commands'],
                ['writes', 'Writes'],
              ]}
            />
            <MetricChart
              title="Average operation latency"
              data={chartRows}
              unit="ms"
              lines={[
                ['readLatency', 'Reads'],
                ['writeLatency', 'Writes'],
                ['commandLatency', 'Commands'],
              ]}
            />
            <MetricChart
              title="Network throughput"
              data={chartRows}
              unit="KB/s"
              lines={[
                ['bytesIn', 'Inbound'],
                ['bytesOut', 'Outbound'],
              ]}
            />
            <MetricChart
              title="Connections and queues"
              data={chartRows}
              unit=""
              lines={[
                ['connections', 'Connections'],
                ['queue', 'Queued readers/writers'],
              ]}
            />
            <MetricChart
              title="Resource utilization"
              data={chartRows}
              unit="%"
              lines={[
                ['connectionUsage', 'Connection capacity'],
                ['cacheUsage', 'Cache'],
                ['dirtyCache', 'Dirty cache'],
              ]}
            />
            <MetricChart
              title="MongoDB process memory"
              data={chartRows}
              unit=" GiB"
              lines={[
                ['residentMemory', 'Resident'],
                ['virtualMemory', 'Virtual address space'],
              ]}
            />
            {isReplicaSet && (
              <MetricChart
                title="Replication lag"
                data={chartRows}
                unit="s"
                lines={[['replicationLag', 'Max secondary lag']]}
              />
            )}
          </div>
          {latest && (
            <CapabilityPanel sample={latest} retentionDays={history?.retentionDays ?? 7} />
          )}
        </>
      )}
    </div>
  )
}
