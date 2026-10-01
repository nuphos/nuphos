import { call } from './client'

export type LinearWorkspace = {
  id: string
  label: string
  workspaceId: string
  workspaceName: string
  organizationUrlKey: string | null
  accountName: string | null
  scope: string
  createdAt?: string
}

export type LinearOAuthStart = {
  authorizeUrl: string
  state: string
  expiresAt: string
}

export type LinearIssueDetail = {
  identifier: string
  title: string
  description: string | null
  priority: number
  priorityLabel: string
  url: string
  createdAt: string
  updatedAt: string
  state: { name: string; type: string; color: string }
  assignee: { name: string; avatarUrl: string | null } | null
  team: { id: string; key: string; name: string; url: string | null }
  labels: { id: string; name: string; color: string }[]
  project: string | null
  cycle: string | null
  comments: {
    id: string
    body: string
    createdAt: string
    author: string
    authorAvatarUrl: string | null
  }[]
}

export type JiraSite = {
  id: string
  label: string
  cloudId: string
  siteName: string
  siteUrl: string
  accountName: string | null
  scope: string
  createdAt?: string
}

export type JiraOAuthStart = {
  authorizeUrl: string
  state: string
  expiresAt: string
}

export type AsanaAccount = {
  id: string
  label: string
  accountGid: string
  accountName: string | null
  accountEmail: string | null
  scope: string
  createdAt?: string
}

export type AsanaOAuthStart = {
  authorizeUrl: string
  state: string
  expiresAt: string
}

export type SentryAccount = {
  id: string
  label: string
  userId: string
  userName: string | null
  userEmail: string | null
  scope: string
  createdAt?: string
}

export type SentryOAuthStart = {
  authorizeUrl: string
  state: string
  expiresAt: string
}

// Aggregated connector inventory (GET /teams/:id/connectors). The full shape
// is typed renderer-side (TeamConnectorsBundle); electron passes it through —
// EXCEPT the CN providers: their backend views key bindings as `accountId`
// while the renderer types (and every consumer) use `id`, a rename the old
// per-provider list calls performed here. Skipping it made the sidebar build
// `integration:tencent:undefined` keys and cluster routes call the backend
// with a literal "undefined" accountId.
export async function listTeamConnectors(teamId: string): Promise<unknown> {
  const bundle = await call<Record<string, unknown>>(
    'GET',
    `/teams/${teamId}/connectors`,
    undefined,
    { timeoutMs: 60_000 },
  )
  const renameAccountId = (items: unknown): unknown =>
    Array.isArray(items)
      ? items.map((item) => {
          const record = item as Record<string, unknown>

          return { ...record, id: record.accountId ?? record.id }
        })
      : items

  return {
    ...bundle,
    tencent: renameAccountId(bundle.tencent),
    aliyun: renameAccountId(bundle.aliyun),
    volcengine: renameAccountId(bundle.volcengine),
    azure: renameAccountId(bundle.azure),
  }
}

export async function listLinearWorkspaces(teamId: string): Promise<LinearWorkspace[]> {
  const data = await call<{ workspaces?: LinearWorkspace[] } | LinearWorkspace[]>(
    'GET',
    `/teams/${teamId}/linear-workspaces`,
  )

  if (Array.isArray(data)) return data

  return data.workspaces ?? []
}

export async function startLinearOAuth(teamId: string): Promise<LinearOAuthStart> {
  return call<LinearOAuthStart>(
    'POST',
    `/teams/${teamId}/linear-workspaces/start-oauth`,
    {},
    { retry: false },
  )
}

export async function cancelLinearOAuth(teamId: string, state: string): Promise<void> {
  await call<void>(
    'DELETE',
    `/teams/${teamId}/linear-workspaces/start-oauth/${encodeURIComponent(state)}`,
    undefined,
    { retry: false },
  )
}

export async function unbindLinear(teamId: string, bindingId: string): Promise<void> {
  await call<void>(
    'DELETE',
    `/teams/${teamId}/linear-workspaces/${encodeURIComponent(bindingId)}`,
    undefined,
    { retry: false },
  )
}

export async function getLinearIssue(
  teamId: string,
  bindingId: string,
  identifier: string,
): Promise<LinearIssueDetail> {
  return call<LinearIssueDetail>(
    'GET',
    `/teams/${teamId}/linear-workspaces/${encodeURIComponent(bindingId)}/issues/${encodeURIComponent(identifier)}`,
  )
}

export async function listJiraSites(teamId: string): Promise<JiraSite[]> {
  const data = await call<{ sites?: JiraSite[] } | JiraSite[]>('GET', `/teams/${teamId}/jira-sites`)

  if (Array.isArray(data)) return data

  return data.sites ?? []
}

export async function startJiraOAuth(teamId: string): Promise<JiraOAuthStart> {
  return call<JiraOAuthStart>(
    'POST',
    `/teams/${teamId}/jira-sites/start-oauth`,
    {},
    { retry: false },
  )
}

export async function cancelJiraOAuth(teamId: string, state: string): Promise<void> {
  await call<void>(
    'DELETE',
    `/teams/${teamId}/jira-sites/start-oauth/${encodeURIComponent(state)}`,
    undefined,
    { retry: false },
  )
}

export async function unbindJira(teamId: string, bindingId: string): Promise<void> {
  await call<void>(
    'DELETE',
    `/teams/${teamId}/jira-sites/${encodeURIComponent(bindingId)}`,
    undefined,
    { retry: false },
  )
}

export async function listAsanaAccounts(teamId: string): Promise<AsanaAccount[]> {
  const data = await call<{ accounts?: AsanaAccount[] } | AsanaAccount[]>(
    'GET',
    `/teams/${teamId}/asana-accounts`,
  )

  if (Array.isArray(data)) return data

  return data.accounts ?? []
}

export async function startAsanaOAuth(teamId: string): Promise<AsanaOAuthStart> {
  return call<AsanaOAuthStart>(
    'POST',
    `/teams/${teamId}/asana-accounts/start-oauth`,
    {},
    { retry: false },
  )
}

export async function cancelAsanaOAuth(teamId: string, state: string): Promise<void> {
  await call<void>(
    'DELETE',
    `/teams/${teamId}/asana-accounts/start-oauth/${encodeURIComponent(state)}`,
    undefined,
    { retry: false },
  )
}

export async function unbindAsana(teamId: string, bindingId: string): Promise<void> {
  await call<void>(
    'DELETE',
    `/teams/${teamId}/asana-accounts/${encodeURIComponent(bindingId)}`,
    undefined,
    { retry: false },
  )
}

export async function listSentryAccounts(teamId: string): Promise<SentryAccount[]> {
  const data = await call<{ accounts?: SentryAccount[] } | SentryAccount[]>(
    'GET',
    `/teams/${teamId}/sentry-accounts`,
  )

  if (Array.isArray(data)) return data

  return data.accounts ?? []
}

export async function startSentryOAuth(teamId: string): Promise<SentryOAuthStart> {
  return call<SentryOAuthStart>(
    'POST',
    `/teams/${teamId}/sentry-accounts/start-oauth`,
    {},
    { retry: false },
  )
}

export async function cancelSentryOAuth(teamId: string, state: string): Promise<void> {
  await call<void>(
    'DELETE',
    `/teams/${teamId}/sentry-accounts/start-oauth/${encodeURIComponent(state)}`,
    undefined,
    { retry: false },
  )
}

export async function unbindSentry(teamId: string, bindingId: string): Promise<void> {
  await call<void>(
    'DELETE',
    `/teams/${teamId}/sentry-accounts/${encodeURIComponent(bindingId)}`,
    undefined,
    { retry: false },
  )
}
