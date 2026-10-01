import { call } from './client'

export type LinearTeamSummary = {
  id: string
  key: string
  name: string
  color: string | null
  url: string | null
}

export type LinearIssueRow = {
  identifier: string
  title: string
  url: string
  priority: number
  priorityLabel: string
  updatedAt: string
  state: { name: string; type: string; color: string }
  assignee: { name: string; avatarUrl: string | null } | null
}

export type LinearTeamIssuesPage = {
  team: Omit<LinearTeamSummary, 'color'>
  issues: LinearIssueRow[]
  nextCursor: string | null
}

function bindingPath(teamId: string, bindingId: string): string {
  return `/teams/${teamId}/linear-workspaces/${encodeURIComponent(bindingId)}`
}

export async function listLinearTeams(
  teamId: string,
  bindingId: string,
): Promise<{ teams: LinearTeamSummary[] }> {
  return call<{ teams: LinearTeamSummary[] }>('GET', `${bindingPath(teamId, bindingId)}/teams`)
}

export async function listLinearTeamIssues(
  teamId: string,
  bindingId: string,
  linearTeamId: string,
  cursor?: string,
): Promise<LinearTeamIssuesPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''

  return call<LinearTeamIssuesPage>(
    'GET',
    `${bindingPath(teamId, bindingId)}/teams/${encodeURIComponent(linearTeamId)}/issues${query}`,
  )
}
