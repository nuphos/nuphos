import { pathSegment, pathSegments } from './url.ts'

import type { GcpProject } from '../../types'

// Keyed by the console's leading path segments, longest match first.
const SECTIONS: { prefix: string[]; segment: string }[] = [
  { prefix: ['compute'], segment: 'gce-instances' },
  { prefix: ['networking', 'networks'], segment: 'vpcs' },
  { prefix: ['networking', 'firewalls'], segment: 'firewalls' },
  { prefix: ['kubernetes'], segment: 'gke-clusters' },
  { prefix: ['run'], segment: 'cloud-run' },
  { prefix: ['monitoring', 'dashboards'], segment: 'dashboards' },
  { prefix: ['monitoring', 'metrics-explorer'], segment: 'metrics' },
  { prefix: ['iam-admin', 'iam'], segment: 'iam' },
]

function sectionForSegments(segs: string[]): string | null {
  const matches = SECTIONS.filter((section) =>
    section.prefix.every((part, index) => segs[index] === part),
  ).sort((a, b) => b.prefix.length - a.prefix.length)

  return matches[0]?.segment ?? null
}

/** The console names the project in `?project=`; a lone binding needs no name. */
function projectIdForUrl(url: URL, projects: readonly GcpProject[]): string | null {
  const bound = [...new Set(projects.map((project) => project.projectId))]
  const named = url.searchParams.get('project')

  if (named) return bound.includes(named) ? named : null

  return bound.length === 1 ? (bound[0] ?? null) : null
}

export function gcpAppPath(
  teamId: string,
  projects: readonly GcpProject[],
  url: URL,
): string | null {
  if (url.protocol !== 'https:') return null
  if (url.hostname.toLowerCase() !== 'console.cloud.google.com') return null
  const segs = pathSegments(url)

  if (!segs) return null
  const segment = sectionForSegments(segs)
  const projectId = projectIdForUrl(url, projects)

  if (!segment || !projectId) return null

  return `/teams/${pathSegment(teamId)}/infra/gcp/${pathSegment(projectId)}/${segment}`
}
