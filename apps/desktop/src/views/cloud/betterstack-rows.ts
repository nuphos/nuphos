import type {
  BetterStackCollector,
  BetterStackDashboard,
  BetterStackHeartbeat,
  BetterStackIncident,
  BetterStackMonitor,
  BetterStackSource,
} from '../../types'

export type BetterStackPage = 'monitors' | 'incidents' | 'sources' | 'dashboards'

export type BetterStackRow = {
  key: string
  kind: string
  name: string
  detail: string
  status: string | null
  updatedAt: string | null
}

export function buildBetterStackRows(
  page: BetterStackPage,
  data: {
    monitors: BetterStackMonitor[]
    heartbeats: BetterStackHeartbeat[]
    incidents: BetterStackIncident[]
    dashboards: BetterStackDashboard[]
    sources: BetterStackSource[]
    collectors: BetterStackCollector[]
  },
): BetterStackRow[] {
  const { monitors, heartbeats, incidents, dashboards, sources, collectors } = data

  if (page === 'monitors') {
    return [
      ...monitors.map((monitor) => ({
        key: `monitor:${monitor.id}`,
        kind: 'Monitor',
        name: monitor.pronounceableName || monitor.url || monitor.id,
        detail: monitor.url || monitor.monitorType || '',
        status: monitor.status || 'unknown',
        updatedAt: monitor.updatedAt || monitor.createdAt,
      })),
      ...heartbeats.map((heartbeat) => ({
        key: `heartbeat:${heartbeat.id}`,
        kind: 'Heartbeat',
        name: heartbeat.name || heartbeat.id,
        detail: heartbeat.period != null ? `every ${String(heartbeat.period)}s` : '',
        status: heartbeat.status || (heartbeat.pausedAt ? 'paused' : 'unknown'),
        updatedAt: heartbeat.updatedAt || heartbeat.createdAt,
      })),
    ]
  }
  if (page === 'incidents') {
    return incidents.map((incident) => ({
      key: `incident:${incident.id}`,
      kind: 'Incident',
      name: incident.name || incident.url || incident.id,
      detail: incident.cause || incident.url || '',
      status: incident.status || 'unknown',
      updatedAt: incident.resolvedAt || incident.acknowledgedAt || incident.startedAt,
    }))
  }
  if (page === 'dashboards') {
    return dashboards.map((dashboard) => ({
      key: `dashboard:${dashboard.id}`,
      kind: 'Dashboard',
      name: dashboard.name || dashboard.id,
      detail: '',
      status: null,
      updatedAt: dashboard.updatedAt || dashboard.createdAt,
    }))
  }

  return [
    ...sources.map((source) => ({
      key: `source:${source.id}`,
      kind: 'Source',
      name: source.name || source.id,
      detail: source.tableName || source.platform || '',
      status: source.ingestingPaused ? 'paused' : 'ingesting',
      updatedAt: source.updatedAt || source.createdAt,
    })),
    ...collectors.map((collector) => ({
      key: `collector:${collector.id}`,
      kind: 'Collector',
      name: collector.name || collector.id,
      detail: collector.platform || collector.dataRegion || '',
      status: collector.status || (collector.ingestingPaused ? 'paused' : 'unknown'),
      updatedAt: collector.updatedAt || collector.pingedAt || collector.createdAt,
    })),
  ]
}
