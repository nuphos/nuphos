import { posthogGet, PosthogApiError } from './posthog-request'

import type { PosthogCredentials, PosthogFetch } from './posthog-request'
import type { PosthogProjectRef } from '@/models'

export { POSTHOG_REGION_HOSTS, PosthogApiError } from './posthog-request'
export type { PosthogCredentials, PosthogFetch } from './posthog-request'

const MAX_ORGANIZATIONS = 20
const PROJECT_PAGE_SIZE = 200
const MAX_PROJECT_PAGES = 5

type MeResponse = {
  uuid?: string
  email?: string
  first_name?: string
  last_name?: string
  organizations?: { id?: string; name?: string }[]
  team?: { id?: number; name?: string; organization?: string } | null
}

type ProjectsPage = {
  next?: string | null
  results?: { id?: number; name?: string }[]
}

export type PosthogDiscovery = {
  user: { uuid: string | null; email: string | null; name: string | null }
  projects: PosthogProjectRef[]
}

async function listOrganizationProjects(
  credentials: PosthogCredentials,
  organization: { id: string; name: string | null },
  fetchImpl?: PosthogFetch,
): Promise<PosthogProjectRef[]> {
  const projects: PosthogProjectRef[] = []

  for (let page = 0; page < MAX_PROJECT_PAGES; page++) {
    const body = await posthogGet<ProjectsPage>(
      credentials,
      `/api/organizations/${encodeURIComponent(organization.id)}/projects/?limit=${String(PROJECT_PAGE_SIZE)}&offset=${String(page * PROJECT_PAGE_SIZE)}`,
      fetchImpl,
    )

    for (const project of body.results ?? []) {
      if (typeof project.id !== 'number') continue
      projects.push({
        id: project.id,
        name: project.name?.trim() || `Project ${String(project.id)}`,
        organizationId: organization.id,
        organizationName: organization.name,
      })
    }
    if (!body.next) break
  }

  return projects
}

/**
 * Lists the projects the grant reaches. An organization outside the grant
 * answers 403 and is skipped; `scopedTeams` (from the token response) narrows
 * the list to the projects the user picked on PostHog's consent screen.
 */
export async function discoverPosthogAccount(
  credentials: PosthogCredentials,
  scopedTeams: number[] = [],
  fetchImpl?: PosthogFetch,
): Promise<PosthogDiscovery> {
  const me = await posthogGet<MeResponse>(credentials, '/api/users/@me/', fetchImpl)
  const organizations = (me.organizations ?? [])
    .filter((org): org is { id: string; name?: string } => typeof org.id === 'string')
    .slice(0, MAX_ORGANIZATIONS)
  const projects: PosthogProjectRef[] = []

  for (const org of organizations) {
    try {
      projects.push(
        ...(await listOrganizationProjects(
          credentials,
          { id: org.id, name: org.name?.trim() || null },
          fetchImpl,
        )),
      )
    } catch (err) {
      if (!(err instanceof PosthogApiError) || err.status !== 403) throw err
    }
  }

  const allowed = new Set(scopedTeams)
  const reachable = dedupeProjects(projects).filter(
    (project) => allowed.size === 0 || allowed.has(project.id),
  )
  const name = [me.first_name, me.last_name].filter(Boolean).join(' ').trim()

  return {
    user: { uuid: me.uuid ?? null, email: me.email ?? null, name: name || null },
    projects: reachable,
  }
}

function dedupeProjects(projects: PosthogProjectRef[]): PosthogProjectRef[] {
  const seen = new Set<number>()

  return projects.filter((project) => {
    if (seen.has(project.id)) return false
    seen.add(project.id)

    return true
  })
}
