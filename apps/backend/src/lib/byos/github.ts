import { generateAppJwt } from '@/lib/byos/github-app-auth'
import { GITHUB_API, GithubApiError, githubFetch, USER_AGENT } from '@/lib/byos/github-http'

import type { GithubRequestInit } from '@/lib/byos/github-http'

export {
  buildInstallUrl,
  generateAppJwt,
  getGithubAppSlug,
  GithubAppNotConfigured,
  isGithubAppConfigured,
  verifyWebhookSignature,
} from '@/lib/byos/github-app-auth'
export { GithubApiError } from '@/lib/byos/github-http'

export type GithubInstallationInfo = {
  id: number
  account: {
    id: number
    login: string
    type: 'User' | 'Organization'
  }
  appId: number
  targetType: 'User' | 'Organization'
  permissions: Record<string, string>
  repositorySelection: 'all' | 'selected'
  events: string[]
  createdAt: string
  updatedAt: string
  suspendedAt: string | null
}

export type GithubRepository = {
  id: number
  nodeId: string
  name: string
  fullName: string
  private: boolean
  htmlUrl: string
  description: string | null
  defaultBranch: string | null
  archived: boolean
  disabled: boolean
  visibility: string | null
  pushedAt: string | null
  updatedAt: string | null
}

async function appRequest<T>(path: string, init?: GithubRequestInit): Promise<T> {
  const jwt = generateAppJwt()
  const res = await githubFetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': USER_AGENT,
    },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')

    throw new GithubApiError(
      res.status,
      `GitHub App API ${path} failed: ${String(res.status)} ${text}`,
    )
  }

  return (await res.json()) as T
}

type RawInstallation = {
  id: number
  account: { id: number; login: string; type: string } | null
  app_id: number
  target_type: 'User' | 'Organization'
  permissions: Record<string, string>
  repository_selection: 'all' | 'selected'
  events: string[]
  created_at: string
  updated_at: string
  suspended_at: string | null
}

function mapInstallation(raw: RawInstallation): GithubInstallationInfo {
  const accountType = raw.account?.type === 'Organization' ? 'Organization' : 'User'

  return {
    id: raw.id,
    account: {
      id: raw.account?.id ?? 0,
      login: raw.account?.login ?? '',
      type: accountType,
    },
    appId: raw.app_id,
    targetType: raw.target_type,
    permissions: raw.permissions ?? {},
    repositorySelection: raw.repository_selection,
    events: raw.events ?? [],
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    suspendedAt: raw.suspended_at,
  }
}

export async function getInstallation(installationId: number): Promise<GithubInstallationInfo> {
  const raw = await appRequest<RawInstallation>(`/app/installations/${String(installationId)}`)

  return mapInstallation(raw)
}

type InstallationToken = { token: string; expiresAt: Date }
const installationTokenCache = new Map<number, InstallationToken>()
const installationTokenInflight = new Map<number, Promise<InstallationToken>>()

export async function getInstallationToken(installationId: number): Promise<InstallationToken> {
  const cached = installationTokenCache.get(installationId)

  if (cached && cached.expiresAt.getTime() - 60_000 > Date.now()) return cached

  const inflight = installationTokenInflight.get(installationId)

  if (inflight) return inflight

  const refresh = appRequest<{ token: string; expires_at: string }>(
    `/app/installations/${String(installationId)}/access_tokens`,
    { method: 'POST' },
  )
    .then((raw) => {
      const out = { token: raw.token, expiresAt: new Date(raw.expires_at) }

      installationTokenCache.set(installationId, out)

      return out
    })
    .finally(() => {
      installationTokenInflight.delete(installationId)
    })

  installationTokenInflight.set(installationId, refresh)

  return refresh
}

export function invalidateInstallationToken(installationId: number): void {
  installationTokenCache.delete(installationId)
}

async function installationRequest<T>(
  installationId: number,
  path: string,
  init?: GithubRequestInit,
): Promise<T> {
  const { token } = await getInstallationToken(installationId)
  const res = await githubFetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': USER_AGENT,
    },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')

    throw new GithubApiError(
      res.status,
      `GitHub installation API ${path} failed: ${String(res.status)} ${text}`,
    )
  }

  return (await res.json()) as T
}

type RawRepository = {
  id: number
  node_id: string
  name: string
  full_name: string
  private: boolean
  html_url: string
  description: string | null
  default_branch: string | null
  archived: boolean
  disabled: boolean
  visibility: string | null
  pushed_at: string | null
  updated_at: string | null
}

function mapRepo(raw: RawRepository): GithubRepository {
  return {
    id: raw.id,
    nodeId: raw.node_id,
    name: raw.name,
    fullName: raw.full_name,
    private: raw.private,
    htmlUrl: raw.html_url,
    description: raw.description,
    defaultBranch: raw.default_branch,
    archived: raw.archived,
    disabled: raw.disabled,
    visibility: raw.visibility,
    pushedAt: raw.pushed_at,
    updatedAt: raw.updated_at,
  }
}

export async function listInstallationRepositories(
  installationId: number,
): Promise<GithubRepository[]> {
  const out: GithubRepository[] = []
  let page = 1
  const perPage = 100
  const maxPages = 50

  while (true) {
    const data = await installationRequest<{
      total_count: number
      repositories: RawRepository[]
    }>(
      installationId,
      `/installation/repositories?per_page=${String(perPage)}&page=${String(page)}`,
    )

    for (const repo of data.repositories) out.push(mapRepo(repo))
    if (data.repositories.length < perPage) break
    page += 1
    if (page > maxPages) {
      if (data.total_count > out.length) {
        throw new GithubApiError(
          502,
          `GitHub installation has ${String(data.total_count)} repositories, exceeds the ${String(perPage * maxPages)}-repo cap of this endpoint`,
        )
      }
      break
    }
  }

  return out
}
