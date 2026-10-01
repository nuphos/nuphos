import { pathSegment, pathSegments } from './url.ts'

import type { CloudflareAccount } from '../../types'

// Worker-family sections, keyed by the dash's own segment: the page it lands
// on, and the segment that precedes a named resource there.
const WORKER_SECTIONS = new Map<string, { page: string; at: string }>([
  ['services', { page: 'workers', at: 'view' }],
  ['pages', { page: 'pages', at: 'view' }],
  ['d1', { page: 'd1', at: 'databases' }],
  ['kv', { page: 'kv', at: 'namespaces' }],
])

/**
 * In-app section (plus drill-down) for a dash.cloudflare.com route below the
 * account id, or null when the app has no page for it.
 *
 * Zone pages are deliberately absent: the dash addresses a zone by name while
 * the in-app route needs its id, and landing on a zone that cannot load is
 * worse than staying in the browser.
 */
function cloudflarePageSegments(inner: string[]): string[] | null {
  const [first, second, third, fourth] = inner

  if (first === 'r2') return third === 'buckets' && fourth ? ['r2', fourth] : ['r2']
  if (first !== 'workers' && first !== 'workers-and-pages') return null
  const section = WORKER_SECTIONS.get(second)

  if (!section) return ['workers']

  return third === section.at && fourth ? [section.page, fourth] : [section.page]
}

export function cloudflareAppPath(
  teamId: string,
  accounts: readonly CloudflareAccount[],
  url: URL,
): string | null {
  if (url.protocol !== 'https:') return null
  if (url.hostname.toLowerCase() !== 'dash.cloudflare.com') return null
  const segs = pathSegments(url)

  if (!segs) return null
  const [accountId, ...inner] = segs

  if (!accounts.some((account) => account.accountId === accountId)) return null
  const page = cloudflarePageSegments(inner)

  if (!page) return null

  return `/teams/${pathSegment(teamId)}/infra/cloudflare/${pathSegment(accountId)}/${page.map(pathSegment).join('/')}`
}
