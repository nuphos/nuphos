import { framesFromResults, proxy } from './base'
import { createReportedError } from '../../lib/frontendErrorReporter'

import type { DataFrame } from '../types'
import type { GrafanaTarget, RawResult } from './base'

export type TempoTraceSummary = {
  traceId: string
  rootServiceName?: string
  rootTraceName?: string
  startTimeUnixNano?: string
  durationMs?: number
}

export type TempoSpan = {
  traceId?: string
  spanId: string
  parentSpanId?: string
  name: string
  serviceName?: string
  startTimeUnixNano: number
  endTimeUnixNano: number
  durationMs: number
  attributes: Record<string, unknown>
}

export type TempoTrace = {
  traceId: string
  spans: TempoSpan[]
  raw: unknown
  searchedRangeMs?: number
}

export async function searchTempoTraces(
  target: GrafanaTarget,
  datasourceUid: string,
  opts: { query: string; startSec: number; endSec: number; limit: number },
): Promise<TempoTraceSummary[]> {
  const frames = await queryTempo(target, datasourceUid, {
    query: opts.query.trim() || '{}',
    queryType: 'traceql',
    startSec: opts.startSec,
    endSec: opts.endSec,
    limit: opts.limit,
  })

  return normalizeTempoSearchFrames(frames)
}

export async function getTempoTrace(
  target: GrafanaTarget,
  datasourceUid: string,
  traceId: string,
  opts?: { startSec?: number; endSec?: number },
): Promise<TempoTrace> {
  const nowSec = Math.floor(Date.now() / 1000)
  const endSec = opts?.endSec ?? nowSec
  const initialStartSec = opts?.startSec ?? endSec - 60 * 60
  const starts = [
    initialStartSec,
    endSec - 6 * 60 * 60,
    endSec - 24 * 60 * 60,
    endSec - 7 * 24 * 60 * 60,
  ].filter((start, i, arr) => arr.indexOf(start) === i)

  let lastError: unknown = null

  for (const startSec of starts) {
    try {
      const frames = await queryTempo(target, datasourceUid, {
        query: traceId.trim(),
        queryType: 'traceId',
        startSec,
        endSec,
        limit: 1,
      })
      const trace = normalizeTempoTraceFrames(traceId, frames)

      if (trace.spans.length > 0) {
        return {
          ...trace,
          searchedRangeMs: Math.max(0, (endSec - startSec) * 1000),
        }
      }
    } catch (e) {
      lastError = e
      if (!isTraceNotFoundError(e)) throw e
    }
  }

  const shouldRethrow = lastError != null && !isTraceNotFoundError(lastError)

  if (shouldRethrow) throw lastError
  throw createReportedError({
    source: 'grafana',
    phase: 'trace_not_found',
    message: `Trace ${traceId} was not found in the last 7 days.`,
  })
}

async function queryTempo(
  target: GrafanaTarget,
  datasourceUid: string,
  opts: {
    query: string
    queryType: 'traceql' | 'traceId'
    startSec: number
    endSec: number
    limit: number
  },
): Promise<DataFrame[]> {
  const res = await proxy<{ results: Record<string, RawResult> }>(target, 'POST', `/api/ds/query`, {
    queries: [
      {
        refId: 'A',
        datasource: { type: 'tempo', uid: datasourceUid },
        query: opts.query,
        queryType: opts.queryType,
        limit: opts.limit,
        tableType: 'traces',
      },
    ],
    from: String(opts.startSec * 1000),
    to: String(opts.endSec * 1000),
  })

  return framesFromResults(res, 'Tempo query')
}

function normalizeTempoSearchFrames(frames: DataFrame[]): TempoTraceSummary[] {
  const out: TempoTraceSummary[] = []

  for (const frame of frames) {
    const traceIds = fieldValues(frame, 'traceID', 'traceId')
    const starts = fieldValues(frame, 'startTime')
    const services = fieldValues(frame, 'traceService', 'rootServiceName')
    const names = fieldValues(frame, 'traceName', 'rootTraceName')
    const durations = fieldValues(frame, 'traceDuration', 'durationMs')

    for (let i = 0; i < traceIds.length; i += 1) {
      const traceId = stringFrom(traceIds[i]) ?? ''

      if (!traceId) continue
      out.push({
        traceId,
        rootServiceName: stringFrom(services[i]),
        rootTraceName: stringFrom(names[i]),
        startTimeUnixNano: starts[i] == null ? undefined : String(Number(starts[i]) * 1e6),
        durationMs: numberFrom(durations[i]),
      })
    }
  }

  return out
}

function normalizeTempoTraceFrames(traceId: string, frames: DataFrame[]): TempoTrace {
  const spans: TempoSpan[] = []

  for (const frame of frames) {
    const metaType = frame.meta?.preferredVisualisationType
    const spanIds = fieldValues(frame, 'spanID', 'spanId')

    if (metaType !== 'trace' && spanIds.length === 0) continue
    const traceIds = fieldValues(frame, 'traceID', 'traceId')
    const parentIds = fieldValues(frame, 'parentSpanID', 'parentSpanId')
    const names = fieldValues(frame, 'operationName', 'name')
    const services = fieldValues(frame, 'serviceName')
    const startsMs = fieldValues(frame, 'startTime')
    const durationsMs = fieldValues(frame, 'duration')
    const tags = fieldValues(frame, 'tags')

    for (let i = 0; i < spanIds.length; i += 1) {
      const spanId = stringFrom(spanIds[i]) ?? ''

      if (!spanId) continue
      const startMs = numberFrom(startsMs[i]) ?? 0
      const durationMs = numberFrom(durationsMs[i]) ?? 0
      const startNs = startMs * 1e6

      spans.push({
        traceId: stringFrom(traceIds[i]),
        spanId,
        parentSpanId: stringFrom(parentIds[i]),
        name: stringFrom(names[i]) || spanId,
        serviceName: stringFrom(services[i]),
        startTimeUnixNano: startNs,
        endTimeUnixNano: startNs + durationMs * 1e6,
        durationMs,
        attributes: tagsToRecord(tags[i]),
      })
    }
  }
  spans.sort((a, b) => a.startTimeUnixNano - b.startTimeUnixNano)

  return { traceId, spans, raw: frames }
}

function isTraceNotFoundError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error)

  return /not found/i.test(message) || /failed to get trace/i.test(message)
}

function fieldValues(frame: DataFrame, ...names: string[]): unknown[] {
  const found = frame.fields.find((field) => names.includes(field.name))

  return found?.values ?? []
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function numberFrom(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = Number(value)

    if (Number.isFinite(n)) return n
  }

  return undefined
}

function tagsToRecord(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value)) return {}
  const out: Record<string, unknown> = {}

  for (const item of value) {
    const tag = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    const key = stringField(tag, 'key')

    if (key) out[key] = tag.value
  }

  return out
}

function stringField(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key]

  return typeof v === 'string' && v.trim() ? v : undefined
}
