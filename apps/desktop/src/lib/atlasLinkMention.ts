// Parse an Nuphos row link into a structured `MentionTarget`, render a
// contenteditable-safe chip element for it, and resolve the chip's display
// label by fetching the underlying resource where applicable.
//
// The Composer in AgentPanel uses this so pasted/seeded Nuphos URLs render as
// inline mention pills with a type-specific icon and the resource's real name,
// instead of a raw URL or a path segment.

import { AGENT_SUBPAGE_SEGMENTS } from './appRoutes'
import { iconNameForType, svg } from './atlas-link-mention/icons.ts'
import { initialLabel } from './atlas-link-mention/label.ts'
import { parseClusterOrResource, parseInfraLink } from './atlas-link-mention/parseInfra.ts'
import { resolveMentionLabel } from './atlas-link-mention/resolveLabel.ts'
import { isKubernetesClusterProvider } from './kubernetesClusterRoutes'
import { ATLAS_WEB_BASE_URL } from './webBaseUrl'

import type { MentionTarget } from './atlas-link-mention/types.ts'

export { initialLabel, resolveMentionLabel }
export type { MentionTarget }

// ---------------------------------------------------------------------------
// URL → MentionTarget
// ---------------------------------------------------------------------------

export function isAtlasUrl(s: string): boolean {
  const trimmed = s.trim()

  return trimmed.startsWith(`${ATLAS_WEB_BASE_URL}/`) || trimmed === ATLAS_WEB_BASE_URL
}

export function parseAtlasLink(rawUrl: string): MentionTarget | null {
  let url: URL

  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  // Detect trailing slash before splitting drops it — S3 prefix URLs end
  // with `/` to distinguish folders from objects with the same path.
  const trailingSlash = url.pathname.length > 1 && url.pathname.endsWith('/')
  const segs = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)

  // `/teams/<T>/...`
  if (segs[0] !== 'teams' || !segs[1]) return null
  const teamId = segs[1]
  const rest = segs.slice(2)

  // /teams/T/connectors/<parent>/... (legacy: /teams/T/settings/integrations/…)
  const connectorSegs =
    rest[0] === 'connectors'
      ? rest.slice(1)
      : rest[0] === 'settings' && rest[1] === 'integrations'
        ? rest.slice(2)
        : null

  if (connectorSegs) {
    const parentId = connectorSegs[0]
    const inner = connectorSegs.slice(1)

    if (!parentId) return null
    if (inner[0] === 'roles') {
      return { type: 'aws-account', teamId, accountId: parentId }
    }
    if (inner[0] === 'service-accounts') {
      return { type: 'gcp-project', teamId, projectId: parentId }
    }
    if (inner[0] === 'iam') {
      return { type: 'cloudflare-account', teamId, accountId: parentId }
    }
  }

  // /teams/T/k8s/<provider>/<connection>/<region>/<cluster>/...
  if (
    rest[0] === 'k8s' &&
    rest[1] &&
    rest[2] &&
    rest[3] &&
    rest[4] &&
    isKubernetesClusterProvider(rest[1])
  ) {
    return parseClusterOrResource(teamId, rest[1], rest[2], rest[3], rest[4], rest.slice(5), url)
  }

  const infraTarget = parseInfraLink(teamId, rest, trailingSlash, url)

  if (infraTarget) return infraTarget

  // /teams/T/repository/installations/<id>/...
  if (rest[0] === 'repository' && rest[1] === 'installations' && rest[2]) {
    const installationId = rest[2]
    const inner = rest.slice(3)

    if (inner.length === 0) {
      return { type: 'github-installation', teamId, installationId }
    }
    if (inner[0] === 'repos' && inner[1] && inner[2]) {
      const owner = inner[1]
      const repo = inner[2]
      const sub = inner.slice(3)

      if (sub[0] === 'pull-requests' && sub[1]) {
        const state = url.searchParams.get('state')

        return {
          type: 'github-pr',
          teamId,
          installationId,
          owner,
          repo,
          number: sub[1],
          ...(state === 'open' || state === 'closed' || state === 'all' ? { prState: state } : {}),
        }
      }
      if (sub[0] === 'workflows' && sub[1]) {
        return {
          type: 'github-workflow-run',
          teamId,
          installationId,
          owner,
          repo,
          runId: sub[1],
        }
      }

      return {
        type: 'github-repo',
        teamId,
        installationId,
        owner,
        repo,
      }
    }
  }

  // /teams/T/observability/grafana/<id>/...
  if (rest[0] === 'observability' && rest[1] === 'grafana' && rest[2]) {
    const instanceId = rest[2]
    const inner = rest.slice(3)

    if (inner.length === 0 || inner[0] === 'dashboards') {
      if (inner[0] === 'dashboards' && inner[1]) {
        return {
          type: 'grafana-dashboard',
          teamId,
          instanceId,
          uid: inner[1],
        }
      }

      return { type: 'grafana-instance', teamId, instanceId }
    }
    if (inner[0] === 'datasources' && inner[1]) {
      return {
        type: 'grafana-datasource',
        teamId,
        instanceId,
        uid: inner[1],
        traceExplorer: inner[2] === 'trace-explorer',
        logExplorer: inner[2] === 'log-explorer',
      }
    }
    if (inner[0] === 'alerts' && inner[1]) {
      return {
        type: 'grafana-alert',
        teamId,
        instanceId,
        uid: inner[1],
      }
    }
  }

  // /teams/T/monitoring/<provider>/<integrationId>/<kind>/<resourceId>
  if (rest[0] === 'monitoring' && rest[1] && rest[2] && rest[3] && rest[4]) {
    return {
      type: 'monitoring-item',
      teamId,
      provider: rest[1],
      integrationId: rest[2],
      kind: rest[3],
      resourceId: rest[4],
    }
  }

  // /teams/T/plans/<planId>
  if (rest[0] === 'plans' && rest[1]) {
    return { type: 'plan', teamId, planId: rest[1] }
  }

  // /teams/T/agent/<sessionId> — the sibling pages under /agent (Memories,
  // Skills) are not sessions, and this parser runs *before* the route table, so
  // swallowing one here sends its deep link to the Agent page.
  if (rest[0] === 'agent' && rest[1] && !AGENT_SUBPAGE_SEGMENTS.has(rest[1])) {
    return { type: 'agent-session', teamId, sessionId: rest[1] }
  }

  return null
}

// ---------------------------------------------------------------------------
// Chip rendering (returns a DOM element to insert into the contenteditable).
// ---------------------------------------------------------------------------

export function renderMentionChip(url: string): HTMLElement {
  const span = document.createElement('span')

  span.className = 'atlas-mention'
  span.contentEditable = 'false'
  span.dataset.atlasUrl = url
  span.title = url

  const target = parseAtlasLink(url)

  if (!target) {
    span.innerHTML = `${svg('cloud')}<span class="atlas-mention-label">${escapeHtml(url)}</span>`

    return span
  }

  const iconName = iconNameForType(target)
  const initial = initialLabel(target)

  span.innerHTML = `${svg(iconName)}<span class="atlas-mention-label">${escapeHtml(initial)}</span>`

  // Fire-and-forget: if the resource has a richer name on the backend, swap
  // it in. Tied to the URL so re-renders of the same chip don't refetch.
  void resolveMentionLabel(target, url).then((name) => {
    if (!name) return
    const lbl = span.querySelector<HTMLElement>('.atlas-mention-label')

    if (lbl && span.isConnected) lbl.textContent = name
  })

  return span
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
