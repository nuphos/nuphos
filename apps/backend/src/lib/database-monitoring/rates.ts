import type { MongoMonitoringMetrics } from '@/lib/database-monitoring/types'

export type MongoMonitoringRates = {
  queryPerSecond: number | null
  insertPerSecond: number | null
  updatePerSecond: number | null
  deletePerSecond: number | null
  commandPerSecond: number | null
  bytesInPerSecond: number | null
  bytesOutPerSecond: number | null
  readLatencyMicros: number | null
  writeLatencyMicros: number | null
  commandLatencyMicros: number | null
}

function rate(current: number | null, previous: number | null, seconds: number): number | null {
  if (current === null || previous === null || seconds <= 0 || current < previous) return null

  return (current - previous) / seconds
}

function averageDelta(
  currentTotal: number | null,
  previousTotal: number | null,
  currentOps: number | null,
  previousOps: number | null,
): number | null {
  if (
    currentTotal === null ||
    previousTotal === null ||
    currentOps === null ||
    previousOps === null
  )
    return null
  const ops = currentOps - previousOps
  const total = currentTotal - previousTotal

  return ops > 0 && total >= 0 ? total / ops : null
}

export function mongoMonitoringRates(
  current: { sampledAt: Date; metrics: MongoMonitoringMetrics },
  previous?: { sampledAt: Date; metrics: MongoMonitoringMetrics } | null,
): MongoMonitoringRates {
  if (!previous)
    return {
      queryPerSecond: null,
      insertPerSecond: null,
      updatePerSecond: null,
      deletePerSecond: null,
      commandPerSecond: null,
      bytesInPerSecond: null,
      bytesOutPerSecond: null,
      readLatencyMicros: null,
      writeLatencyMicros: null,
      commandLatencyMicros: null,
    }
  const seconds = (current.sampledAt.getTime() - previous.sampledAt.getTime()) / 1_000

  return {
    queryPerSecond: rate(
      current.metrics.operationsQueryTotal,
      previous.metrics.operationsQueryTotal,
      seconds,
    ),
    insertPerSecond: rate(
      current.metrics.operationsInsertTotal,
      previous.metrics.operationsInsertTotal,
      seconds,
    ),
    updatePerSecond: rate(
      current.metrics.operationsUpdateTotal,
      previous.metrics.operationsUpdateTotal,
      seconds,
    ),
    deletePerSecond: rate(
      current.metrics.operationsDeleteTotal,
      previous.metrics.operationsDeleteTotal,
      seconds,
    ),
    commandPerSecond: rate(
      current.metrics.operationsCommandTotal,
      previous.metrics.operationsCommandTotal,
      seconds,
    ),
    bytesInPerSecond: rate(
      current.metrics.networkBytesInTotal,
      previous.metrics.networkBytesInTotal,
      seconds,
    ),
    bytesOutPerSecond: rate(
      current.metrics.networkBytesOutTotal,
      previous.metrics.networkBytesOutTotal,
      seconds,
    ),
    readLatencyMicros: averageDelta(
      current.metrics.readLatencyMicrosTotal,
      previous.metrics.readLatencyMicrosTotal,
      current.metrics.readLatencyOpsTotal,
      previous.metrics.readLatencyOpsTotal,
    ),
    writeLatencyMicros: averageDelta(
      current.metrics.writeLatencyMicrosTotal,
      previous.metrics.writeLatencyMicrosTotal,
      current.metrics.writeLatencyOpsTotal,
      previous.metrics.writeLatencyOpsTotal,
    ),
    commandLatencyMicros: averageDelta(
      current.metrics.commandLatencyMicrosTotal,
      previous.metrics.commandLatencyMicrosTotal,
      current.metrics.commandLatencyOpsTotal,
      previous.metrics.commandLatencyOpsTotal,
    ),
  }
}
