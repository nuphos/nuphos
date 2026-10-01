import { pathSegment, pathSegments } from './url.ts'

import type { LinearWorkspace } from '../../types'

export type LinearLinkTarget = { view: 'issue'; workspaceKey: string; identifier: string }

const ISSUE_IDENTIFIER = /^[A-Za-z0-9]+-\d+$/

export function parseLinearLink(url: URL): LinearLinkTarget | null {
  const hostname = url.hostname.toLowerCase()

  if (url.protocol !== 'https:') return null
  if (hostname !== 'linear.app' && hostname !== 'www.linear.app') return null
  const segs = pathSegments(url)

  if (!segs) return null
  const [workspaceKey, section, identifier] = segs

  if (!workspaceKey || section !== 'issue' || !identifier || !ISSUE_IDENTIFIER.test(identifier)) {
    return null
  }

  return { view: 'issue', workspaceKey, identifier: identifier.toUpperCase() }
}

export function linearAppPath(
  teamId: string,
  workspaces: readonly LinearWorkspace[],
  target: LinearLinkTarget,
): string | null {
  const wanted = target.workspaceKey.toLowerCase()
  const workspace = workspaces.find((w) => w.organizationUrlKey?.toLowerCase() === wanted)

  if (!workspace) return null

  return `/teams/${pathSegment(teamId)}/linear/workspaces/${pathSegment(workspace.id)}/issues/${pathSegment(target.identifier)}`
}
