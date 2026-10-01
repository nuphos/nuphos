import { pathSegment, pathSegments, startsWithSegments } from './url.ts'

import type { GrafanaInstance } from '../../types'

/**
 * In-app page segments for a Grafana route, or null when the app has no page
 * for it (admin, plugins, profile, …).
 */
function grafanaPageSegments(inner: string[]): string[] | null {
  const [first, second] = inner

  if (!first || first === 'home' || first === 'dashboards') return ['dashboards']
  if ((first === 'd' || first === 'd-solo') && second) return ['dashboards', second]
  if (first === 'alerting') return ['alerts']
  if (first === 'datasources') return ['datasources']
  // Explore has no in-app twin: its per-datasource explorers hang off the
  // datasources page, which is one click from the same queries.
  if (first === 'explore') return ['datasources']
  if (first === 'connections' && (!second || second === 'datasources')) return ['datasources']

  return null
}

/**
 * A Grafana instance is reached at whatever URL it was bound with — any host,
 * any port, and possibly a sub-path (`https://host/grafana`) — so matching is
 * by bound origin plus path prefix rather than a fixed hostname.
 *
 * Two instances can share a host with overlapping prefixes (one at the origin,
 * one under `/grafana`), so the longest matching prefix wins rather than
 * whichever happens to be listed first.
 */
export function grafanaAppPath(
  teamId: string,
  instances: readonly GrafanaInstance[],
  url: URL,
): string | null {
  const segs = pathSegments(url)

  if (!segs) return null
  let best: { instance: GrafanaInstance; baseLength: number } | null = null

  for (const instance of instances) {
    let base: URL

    try {
      base = new URL(instance.grafanaUrl)
    } catch {
      continue
    }
    if (base.host.toLowerCase() !== url.host.toLowerCase()) continue
    const baseSegs = pathSegments(base)

    if (!baseSegs || !startsWithSegments(segs, baseSegs)) continue
    if (!best || baseSegs.length > best.baseLength) {
      best = { instance, baseLength: baseSegs.length }
    }
  }
  if (!best) return null
  const page = grafanaPageSegments(segs.slice(best.baseLength))

  if (!page) return null

  return `/teams/${pathSegment(teamId)}/observability/grafana/${pathSegment(best.instance.id)}/${page.map(pathSegment).join('/')}`
}
