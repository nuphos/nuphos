import { navigationFromAppPath } from '../../lib/appRoutes.ts'
import { parseAtlasLink } from '../../lib/atlasLinkMention.ts'
import { navigationFromMentionTarget } from '../mentionNavigation.ts'

import type { NavigationSnapshot } from '../../lib/appRoutes.ts'

/** Mentions whose link the route table reads more fully, such as a conversation link's `?artifact=`. */
const ROUTE_TABLE_FIRST = new Set<string>(['cluster', 'github-repo', 'github-pr', 'agent-session'])

/**
 * Where a Nuphos link leads. Resource-level mention links come first (they carry
 * filter/label niceties); the rest, and anything else the route table can parse
 * (section pages, drill-downs, legacy aliases), resolve through the shared parser.
 */
export function navigationForLink(url: URL): NavigationSnapshot | null {
  const target = parseAtlasLink(url.toString())
  const mention =
    target && !ROUTE_TABLE_FIRST.has(target.type) ? navigationFromMentionTarget(target) : null

  return (
    mention ??
    navigationFromAppPath(`${url.pathname}${url.search}`) ??
    (target ? navigationFromMentionTarget(target) : null)
  )
}
