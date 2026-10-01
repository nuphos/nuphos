import { z } from 'zod'

import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'
import { requireLinearMemberAccess } from '@/middleware/auth'
import { linearTeamUrl, queryBindingGraphql } from '@/routes/linear-workspaces/graphql'

import type { LinearWorkspaceVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

const TEAMS_QUERY = `
  query NuphosTeams {
    teams(first: 250) {
      nodes { id key name color }
    }
  }
`

const TEAM_ISSUES_QUERY = `
  query NuphosTeamIssues($teamId: String!, $first: Int!, $after: String, $filter: IssueFilter) {
    team(id: $teamId) {
      id
      key
      name
      issues(first: $first, after: $after, orderBy: updatedAt, filter: $filter) {
        nodes {
          identifier
          title
          url
          priority
          priorityLabel
          updatedAt
          state { name type color }
          assignee { name avatarUrl }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`

export const OPEN_ISSUES_FILTER = { state: { type: { nin: ['completed', 'canceled'] } } }

const teamParamSchema = z.object({
  linearTeamId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/, 'invalid Linear team id'),
})

const issuesQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  state: z.enum(['open', 'all']).default('open'),
})

type RawTeam = { id: string; key: string; name: string; color: string | null }
type RawIssueRow = {
  identifier: string
  title: string
  url: string
  priority: number
  priorityLabel: string
  updatedAt: string
  state: { name: string; type: string; color: string }
  assignee: { name: string | null; avatarUrl: string | null } | null
}
type RawTeamIssues = Omit<RawTeam, 'color'> & {
  issues: {
    nodes: RawIssueRow[]
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
  }
}

export function registerLinearBrowseRoutes(
  bindingScoped: Hono<{ Variables: LinearWorkspaceVariables }>,
) {
  bindingScoped.get('/teams', requireLinearMemberAccess(), async (c) => {
    const data = await queryBindingGraphql<{ teams: { nodes: RawTeam[] } }>(c, TEAMS_QUERY, {})
    const urlKey = c.get('linearBinding').organizationUrlKey
    const teams = data.teams.nodes
      .map((team) => ({
        id: team.id,
        key: team.key,
        name: team.name,
        color: team.color,
        url: linearTeamUrl(urlKey, team.key),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return c.json({ teams })
  })

  bindingScoped.get(
    '/teams/:linearTeamId/issues',
    requireLinearMemberAccess(),
    zv('param', teamParamSchema),
    zv('query', issuesQuerySchema),
    async (c) => {
      const { linearTeamId } = c.req.valid('param')
      const { cursor, limit, state } = c.req.valid('query')
      const notFound = new AppError(
        404,
        'linear_team_not_found',
        'Linear team not found or not accessible with this connection',
      )
      const data = await queryBindingGraphql<{ team: RawTeamIssues | null }>(
        c,
        TEAM_ISSUES_QUERY,
        {
          teamId: linearTeamId,
          first: limit,
          after: cursor ?? null,
          filter: state === 'open' ? OPEN_ISSUES_FILTER : null,
        },
        notFound,
      )

      if (!data.team) throw notFound
      const { issues, ...team } = data.team

      return c.json({
        team: {
          id: team.id,
          key: team.key,
          name: team.name,
          url: linearTeamUrl(c.get('linearBinding').organizationUrlKey, team.key),
        },
        issues: issues.nodes.map((issue) => ({
          identifier: issue.identifier,
          title: issue.title,
          url: issue.url,
          priority: issue.priority,
          priorityLabel: issue.priorityLabel,
          updatedAt: issue.updatedAt,
          state: issue.state,
          assignee: issue.assignee?.name
            ? { name: issue.assignee.name, avatarUrl: issue.assignee.avatarUrl }
            : null,
        })),
        nextCursor: issues.pageInfo.hasNextPage ? issues.pageInfo.endCursor : null,
      })
    },
  )
}
