import { GitlabApiError, USER_AGENT, gitlabFetch, normalizeHostUrl } from './http'
import { apiRequest } from './tokens'

import type { GitlabBinding } from '@/models'
import type { ObjectId } from 'mongodb'

// ── Public types + mappers ──

export type GitlabUserInfo = {
  id: number
  username: string
  name: string | null
  avatarUrl: string | null
}

type RawGitlabUser = {
  id: number
  username: string
  name?: string | null
  avatar_url?: string | null
}

export async function getCurrentUser(
  hostUrl: string,
  accessToken: string,
): Promise<GitlabUserInfo> {
  const host = normalizeHostUrl(hostUrl)
  const res = await gitlabFetch(`${host}/api/v4/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')

    throw new GitlabApiError(res.status, `GitLab /user failed: ${String(res.status)} ${text}`)
  }
  const raw = (await res.json()) as RawGitlabUser

  return {
    id: raw.id,
    username: raw.username,
    name: raw.name ?? null,
    avatarUrl: raw.avatar_url ?? null,
  }
}

export type GitlabProject = {
  id: number
  name: string
  pathWithNamespace: string
  description: string | null
  defaultBranch: string | null
  visibility: 'private' | 'internal' | 'public'
  webUrl: string
  archived: boolean
  lastActivityAt: string | null
}

type RawProject = {
  id: number
  name: string
  path_with_namespace: string
  description: string | null
  default_branch: string | null
  visibility: 'private' | 'internal' | 'public'
  web_url: string
  archived: boolean
  last_activity_at: string | null
  namespace?: {
    id: number
    name: string
    full_path: string
    kind: 'group' | 'user'
    avatar_url: string | null
    web_url: string
  }
}

function mapProject(raw: RawProject): GitlabProject {
  return {
    id: raw.id,
    name: raw.name,
    pathWithNamespace: raw.path_with_namespace,
    description: raw.description,
    defaultBranch: raw.default_branch,
    visibility: raw.visibility,
    webUrl: raw.web_url,
    archived: raw.archived,
    lastActivityAt: raw.last_activity_at,
  }
}

// A "namespace" is the GitLab analog of a GitHub installation target: the
// top-level group or user namespace a project lives under. Derived from the
// user's membership projects (not group membership) so projects the user was
// invited into — without being a member of the enclosing group — still get a
// sidebar entry.
export type GitlabNamespace = {
  kind: 'group' | 'user'
  id: number
  name: string
  fullPath: string
  avatarUrl: string | null
  webUrl: string
  projectCount: number
}

function rootSegment(pathWithNamespace: string): string {
  const i = pathWithNamespace.lastIndexOf('/')
  const nsPath = i === -1 ? pathWithNamespace : pathWithNamespace.slice(0, i)
  const j = nsPath.indexOf('/')

  return j === -1 ? nsPath : nsPath.slice(0, j)
}

async function listMembershipProjectsRaw(
  teamId: ObjectId,
  binding: GitlabBinding,
): Promise<RawProject[]> {
  const out: RawProject[] = []
  const perPage = 100
  // Runaway backstop, not an expected limit: pagination normally ends on the
  // first short page. Hitting the cap means >10k membership projects — log it
  // so the truncation is visible instead of silently shipping a partial list.
  const maxPages = 100
  let page = 1

  for (; page <= maxPages; page++) {
    const raws = await apiRequest<RawProject[]>(
      teamId,
      binding,
      `/projects?membership=true&per_page=${String(perPage)}&page=${String(page)}&order_by=last_activity_at&sort=desc`,
    )

    out.push(...raws)
    if (raws.length < perPage) break
  }
  if (page > maxPages) {
    console.warn(
      `[gitlab] membership project list truncated at ${String(maxPages * perPage)} for binding ${binding.id.toHexString()} on ${binding.hostUrl}`,
    )
  }

  return out
}

export async function listNamespaces(
  teamId: ObjectId,
  binding: GitlabBinding,
): Promise<GitlabNamespace[]> {
  const raws = await listMembershipProjectsRaw(teamId, binding)
  const byRoot = new Map<string, GitlabNamespace>()

  for (const raw of raws) {
    const root = rootSegment(raw.path_with_namespace)
    const ns = raw.namespace
    const existing = byRoot.get(root)

    if (existing) {
      existing.projectCount++
      // A placeholder created from a subgroup project (id 0, path-segment
      // label) gets upgraded when a later project sits directly in the root
      // namespace and carries its real metadata.
      if (existing.id === 0 && ns && ns.full_path === root) {
        existing.kind = ns.kind
        existing.id = ns.id
        existing.name = ns.name
        existing.avatarUrl = ns.avatar_url
      }
      continue
    }
    // Use the project's namespace metadata only when it IS the root (not a
    // nested subgroup); otherwise fall back to the path segment as the label.
    const isRootNs = ns && ns.full_path === root

    byRoot.set(root, {
      kind: isRootNs ? ns.kind : 'group',
      id: isRootNs ? ns.id : 0,
      name: isRootNs ? ns.name : root,
      fullPath: root,
      avatarUrl: isRootNs ? ns.avatar_url : null,
      webUrl: `${binding.hostUrl}/${root}`,
      projectCount: 1,
    })
  }

  return Array.from(byRoot.values()).sort((a, b) =>
    // Personal namespace of the bound account first, then by path.
    a.fullPath === binding.username
      ? -1
      : b.fullPath === binding.username
        ? 1
        : a.fullPath.localeCompare(b.fullPath),
  )
}

export async function listProjects(
  teamId: ObjectId,
  binding: GitlabBinding,
  namespaceFullPath?: string,
): Promise<GitlabProject[]> {
  const raws = await listMembershipProjectsRaw(teamId, binding)
  const filtered = namespaceFullPath
    ? raws.filter((raw) => rootSegment(raw.path_with_namespace) === namespaceFullPath)
    : raws

  return filtered.map(mapProject)
}
