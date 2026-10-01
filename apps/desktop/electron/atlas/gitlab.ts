import { call } from './client'

export type GitlabBinding = {
  id: string
  hostUrl: string
  accountId: number
  username: string
  displayName: string | null
  avatarUrl: string | null
  clientId: string
  isDefaultClient: boolean
  scope: string
  accessTokenExpiresAt: string | null
  createdAt?: string
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

export type GitlabMergeRequest = {
  iid: number
  title: string
  state: 'opened' | 'closed' | 'merged' | 'locked'
  draft: boolean
  author: string | null
  authorAvatarUrl: string | null
  labels: string[]
  createdAt: string
  updatedAt: string
  webUrl: string
  sourceBranch: string
  targetBranch: string
}

export type GitlabPipeline = {
  id: number
  status: string
  source: string
  ref: string | null
  sha: string
  webUrl: string
  createdAt: string
  updatedAt: string
}

export type GitlabOAuthStart = {
  authorizeUrl: string
  state: string
  hostUrl: string
  expiresAt: string
}

export type GitlabNamespace = {
  kind: 'group' | 'user'
  id: number
  name: string
  fullPath: string
  avatarUrl: string | null
  webUrl: string
  projectCount: number
}

export type GitlabBindingNamespaces = {
  bindingId: string
  hostUrl: string
  username: string
  namespaces: GitlabNamespace[]
}

export async function listGitlabBindings(teamId: string): Promise<GitlabBinding[]> {
  const data = await call<{ bindings?: GitlabBinding[] } | GitlabBinding[]>(
    'GET',
    `/teams/${teamId}/gitlab-bindings`,
  )

  if (Array.isArray(data)) return data

  return data.bindings ?? []
}

export async function startGitlabOAuth(
  teamId: string,
  hostUrl: string,
  clientId?: string,
  clientSecret?: string,
  scopes?: string[],
): Promise<GitlabOAuthStart> {
  return call<GitlabOAuthStart>(
    'POST',
    `/teams/${teamId}/gitlab-bindings/start-oauth`,
    { hostUrl, clientId, clientSecret, ...(scopes && scopes.length > 0 ? { scopes } : {}) },
    { retry: false },
  )
}

export async function cancelGitlabOAuth(teamId: string, state: string): Promise<void> {
  await call<void>(
    'DELETE',
    `/teams/${teamId}/gitlab-bindings/start-oauth/${encodeURIComponent(state)}`,
    undefined,
    { retry: false },
  )
}

export async function unbindGitlab(teamId: string, bindingId: string): Promise<void> {
  await call<void>(
    'DELETE',
    `/teams/${teamId}/gitlab-bindings/${encodeURIComponent(bindingId)}`,
    undefined,
    { retry: false },
  )
}

export async function listGitlabNamespaces(teamId: string): Promise<GitlabBindingNamespaces[]> {
  const data = await call<{ bindings: GitlabBindingNamespaces[] }>(
    'GET',
    `/teams/${teamId}/gitlab-bindings/namespaces`,
  )

  return data.bindings ?? []
}

export async function listGitlabProjects(
  teamId: string,
  bindingId: string,
  namespaceFullPath?: string,
): Promise<GitlabProject[]> {
  const q = namespaceFullPath
    ? `?${String(new URLSearchParams({ namespace: namespaceFullPath }))}`
    : ''
  const data = await call<{ projects: GitlabProject[] }>(
    'GET',
    `/teams/${teamId}/gitlab-bindings/${encodeURIComponent(bindingId)}/projects${q}`,
  )

  return data.projects ?? []
}

export async function listGitlabMergeRequests(
  teamId: string,
  bindingId: string,
  projectId: number,
  state: 'opened' | 'closed' | 'merged' | 'all' = 'opened',
): Promise<GitlabMergeRequest[]> {
  const q = new URLSearchParams({ state }).toString()
  const data = await call<{ mergeRequests: GitlabMergeRequest[] }>(
    'GET',
    `/teams/${teamId}/gitlab-bindings/${encodeURIComponent(bindingId)}/projects/${String(projectId)}/merge-requests?${q}`,
  )

  return data.mergeRequests ?? []
}

export async function listGitlabPipelines(
  teamId: string,
  bindingId: string,
  projectId: number,
  page = 1,
): Promise<GitlabPipeline[]> {
  const q = new URLSearchParams({ page: String(page) }).toString()
  const data = await call<{ pipelines: GitlabPipeline[] }>(
    'GET',
    `/teams/${teamId}/gitlab-bindings/${encodeURIComponent(bindingId)}/projects/${String(projectId)}/pipelines?${q}`,
  )

  return data.pipelines ?? []
}
