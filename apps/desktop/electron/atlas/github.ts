import { call } from './client'

export type GithubInstallation = {
  id: string
  installationId: number
  accountLogin: string
  accountType: 'User' | 'Organization'
  accountId: number
  targetType: 'all' | 'selected'
  createdAt?: string
}

export type GithubRepository = {
  id: number
  name: string
  fullName: string
  private: boolean
  htmlUrl: string
  description: string | null
  defaultBranch: string | null
  archived: boolean
  visibility: string | null
  pushedAt: string | null
}

export type GithubPR = {
  number: number
  title: string
  state: 'open' | 'closed'
  draft: boolean
  author: string
  authorAvatarUrl: string
  labels: { name: string; color: string }[]
  createdAt: string
  updatedAt: string
  htmlUrl: string
  headRef: string
  baseRef: string
}

export type GithubPRDetail = GithubPR & {
  body: string | null
  merged: boolean
  mergeable: boolean | null
  mergeableState: string
  headSha: string
  baseSha: string
  additions: number
  deletions: number
  changedFiles: number
  commits: number
  comments: number
  reviewComments: number
  requestedReviewers: { login: string; avatarUrl: string }[]
  assignees: { login: string; avatarUrl: string }[]
  milestone: string | null
  reviews: {
    id: number
    author: string
    authorAvatarUrl: string
    state: string
    body: string | null
    submittedAt: string | null
    htmlUrl: string
  }[]
  conversation: {
    id: number
    author: string
    authorAvatarUrl: string
    body: string
    createdAt: string
    updatedAt: string
    htmlUrl: string
    path?: string
    line?: number | null
    diffHunk?: string
  }[]
  checks: {
    id: number
    name: string
    status: string
    conclusion: string | null
    detailsUrl: string | null
    appName: string | null
  }[]
  files: {
    filename: string
    status: string
    additions: number
    deletions: number
    changes: number
    patch: string | null
    previousFilename: string | null
  }[]
}

export type GithubWorkflowRun = {
  id: number
  name: string
  status: string
  conclusion: string | null
  event: string
  headBranch: string
  headSha: string
  createdAt: string
  updatedAt: string
  htmlUrl: string
}

export async function listGithubInstallations(teamId: string): Promise<GithubInstallation[]> {
  const data = await call<{ installations?: GithubInstallation[] } | GithubInstallation[]>(
    'GET',
    `/teams/${teamId}/github-installations`,
  )

  if (Array.isArray(data)) return data

  return data.installations ?? []
}

export async function getGithubInstallUrl(
  teamId: string,
): Promise<{ url: string; appSlug: string }> {
  return call<{ url: string; appSlug: string }>(
    'GET',
    `/teams/${teamId}/github-installations/install-url`,
  )
}

// bind / unbind are non-idempotent state changes; a transport error after the
// server already committed should surface to the user instead of silently
// retrying and producing 409s or duplicate-bind weirdness.
export async function bindGithubInstallation(
  teamId: string,
  installationId: number,
): Promise<GithubInstallation> {
  return call<GithubInstallation>(
    'POST',
    `/teams/${teamId}/github-installations`,
    { installationId },
    { retry: false },
  )
}

export async function unbindGithubInstallation(
  teamId: string,
  installationId: number,
): Promise<void> {
  await call<void>(
    'DELETE',
    `/teams/${teamId}/github-installations/${String(installationId)}`,
    undefined,
    {
      retry: false,
    },
  )
}

export async function listGithubRepositories(
  teamId: string,
  installationId: number,
): Promise<GithubRepository[]> {
  const data = await call<{ repositories: GithubRepository[] }>(
    'GET',
    `/teams/${teamId}/github-installations/${String(installationId)}/repositories`,
  )

  return data.repositories ?? []
}

export async function listGithubPulls(
  teamId: string,
  installationId: number,
  owner: string,
  repo: string,
  state: 'open' | 'closed' | 'all' = 'open',
): Promise<GithubPR[]> {
  const o = encodeURIComponent(owner)
  const r = encodeURIComponent(repo)
  const q = new URLSearchParams({ state }).toString()
  const data = await call<
    | GithubPR[]
    | {
        pulls?: GithubPR[]
        pullRequests?: GithubPR[]
        prs?: GithubPR[]
      }
  >(
    'GET',
    `/teams/${teamId}/github-installations/${String(installationId)}/repositories/${o}/${r}/pulls?${q}`,
  )

  if (Array.isArray(data)) return data

  return data.pulls ?? data.pullRequests ?? data.prs ?? []
}

export async function getGithubPull(
  teamId: string,
  installationId: number,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<GithubPRDetail> {
  const o = encodeURIComponent(owner)
  const r = encodeURIComponent(repo)

  return call<GithubPRDetail>(
    'GET',
    `/teams/${teamId}/github-installations/${String(installationId)}/repositories/${o}/${r}/pulls/${String(pullNumber)}`,
  )
}

export async function listGithubActionRuns(
  teamId: string,
  installationId: number,
  owner: string,
  repo: string,
  page = 1,
): Promise<{ runs: GithubWorkflowRun[]; totalCount: number }> {
  const o = encodeURIComponent(owner)
  const r = encodeURIComponent(repo)
  const q = new URLSearchParams({ page: String(page) }).toString()

  return call<{ runs: GithubWorkflowRun[]; totalCount: number }>(
    'GET',
    `/teams/${teamId}/github-installations/${String(installationId)}/repositories/${o}/${r}/actions/runs?${q}`,
  )
}
