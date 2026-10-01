import { parseAtlasLink } from '../../lib/atlasLinkMention'

import type { Diagram } from '../schema'

export const KIND_OPTIONS = ['abstract', 'cloud', 'code']

// Once a node has a `url`, its type is DERIVED from that link rather than set by
// hand: repos/CI → code, plans/sessions → abstract, all infra/cloud → cloud.
// Returns undefined when the url isn't an in-app link we can classify.
export function kindFromUrl(url?: string): string | undefined {
  const target = url ? parseAtlasLink(url) : null

  if (!target) return undefined
  if (target.type.startsWith('github')) return 'code'
  if (target.type === 'plan' || target.type === 'agent-session') return 'abstract'

  return 'cloud'
}

// Subtitle shown under a concrete node — the resource CATEGORY (the node label
// already carries the name). Derived from the url; undefined for abstract nodes.
export function subtitleFromUrl(url?: string): string | undefined {
  const t = url ? parseAtlasLink(url) : null

  if (!t) return undefined
  if (t.type === 'k8s-resource') return `kubernetes · ${t.kind}`
  if (t.type === 'cluster') return 'kubernetes · cluster'

  return t.type.replace(/-/g, ' · ')
}
// App primary (zViolet-500) for selection/active accents — matches the rest of
// the UI rather than an off-brand blue.
export const PRIMARY = 'rgb(var(--color-zViolet-500))'
export const COLOR_SWATCHES = ['', '#6300FF', '#1D9E75', '#7F77DD', '#D85A30', '#BA7517']

export function genId(): string {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 8)
}

// Scatter freshly added nodes so two clicks in a row don't stack them exactly.
export function scatter(span: number): number {
  const bucket = new Uint32Array(1)

  crypto.getRandomValues(bucket)

  return (bucket[0] / 2 ** 32) * span
}

export type Snapshot = Pick<Diagram, 'name' | 'nodes' | 'views'>
export const snap = (d: Diagram): Snapshot => ({ name: d.name, nodes: d.nodes, views: d.views })
