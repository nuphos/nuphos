import { proxy } from './base'
import { createReportedError } from '../../lib/frontendErrorReporter'

import type { GrafanaTarget } from './base'

export type AlertState = 'firing' | 'pending' | 'inactive' | 'normal' | 'nodata' | 'error'

export type AlertInstance = {
  state: AlertState
  labels: Record<string, string>
  annotations: Record<string, string>
  activeAt?: string
  value?: string
}

export type AlertRuleSummary = {
  // Grafana-assigned rule UID. May be absent on very old Grafana — falls back
  // to a synthesized "<folder>/<group>/<name>" composite when missing.
  uid: string
  name: string
  groupName: string
  // `file` from the Prometheus-compatible response; Grafana fills this with
  // the folder title for Grafana-managed rules.
  folderTitle: string
  state: AlertState
  health: string
  query: string
  // Evaluation `for:` duration in seconds.
  duration: number
  labels: Record<string, string>
  annotations: Record<string, string>
  alerts: AlertInstance[]
  lastEvaluation?: string
}

type RawRulesResponse = {
  status?: string
  data?: {
    groups?: {
      name?: string
      file?: string
      rules?: {
        uid?: string
        name?: string
        query?: string
        duration?: number
        labels?: Record<string, string>
        annotations?: Record<string, string>
        state?: string
        health?: string
        type?: string
        lastEvaluation?: string
        alerts?: {
          state?: string
          labels?: Record<string, string>
          annotations?: Record<string, string>
          activeAt?: string
          value?: string
        }[]
      }[]
    }[]
  }
}

function normalizeAlertState(s: string | undefined): AlertState {
  const v = (s ?? '').toLowerCase()

  if (v === 'firing' || v === 'alerting') return 'firing'
  if (v === 'pending') return 'pending'
  if (v === 'inactive' || v === 'normal' || v === 'ok') return 'inactive'
  if (v === 'nodata') return 'nodata'
  if (v === 'error') return 'error'

  return 'inactive'
}

export async function listAlertRules(target: GrafanaTarget): Promise<AlertRuleSummary[]> {
  const raw = await proxy<RawRulesResponse>(
    target,
    'GET',
    `/api/prometheus/grafana/api/v1/rules?type=alert`,
  )

  // Prometheus-compatible APIs always return { status: 'success' | 'error' }.
  // If status is present and not 'success', surface the failure instead of
  // silently rendering an empty list.
  if (raw.status && raw.status !== 'success') {
    throw createReportedError({
      source: 'grafana',
      phase: 'alert_rules_result_error',
      message: `Failed to load alert rules (status: ${raw.status})`,
      status: raw.status,
    })
  }
  const out: AlertRuleSummary[] = []

  for (const g of raw.data?.groups ?? []) {
    const folderTitle = g.file ?? ''
    const groupName = g.name ?? ''

    for (const r of g.rules ?? []) {
      if (r.type && r.type !== 'alerting') continue
      const name = r.name ?? ''

      out.push({
        uid: r.uid || `${folderTitle}/${groupName}/${name}`,
        name,
        groupName,
        folderTitle,
        state: normalizeAlertState(r.state),
        health: r.health ?? '',
        query: r.query ?? '',
        duration: r.duration ?? 0,
        labels: r.labels ?? {},
        annotations: r.annotations ?? {},
        alerts: (r.alerts ?? []).map((a) => ({
          state: normalizeAlertState(a.state),
          labels: a.labels ?? {},
          annotations: a.annotations ?? {},
          activeAt: a.activeAt,
          value: a.value,
        })),
        lastEvaluation: r.lastEvaluation,
      })
    }
  }

  return out
}
