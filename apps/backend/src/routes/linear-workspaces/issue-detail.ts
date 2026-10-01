import { z } from 'zod'

import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'
import { requireLinearMemberAccess } from '@/middleware/auth'
import { linearTeamUrl, queryBindingGraphql } from '@/routes/linear-workspaces/graphql'

import type { LinearWorkspaceVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

const ISSUE_DETAIL_QUERY = `
  query NuphosIssueDetail($id: String!) {
    issue(id: $id) {
      identifier
      title
      description
      priority
      priorityLabel
      url
      createdAt
      updatedAt
      state { name type color }
      assignee { name avatarUrl }
      team { id key name }
      labels(first: 50) { nodes { id name color } }
      project { name }
      cycle { name number }
      comments(first: 100, orderBy: createdAt) {
        nodes {
          id
          body
          createdAt
          user { name avatarUrl }
        }
      }
    }
  }
`

const issueIdentifierSchema = z.object({
  identifier: z.string().regex(/^[A-Za-z0-9]+-\d+$/, 'invalid Linear issue identifier'),
})

type RawIssueUser = { name: string | null; avatarUrl: string | null }
type RawIssueDetail = {
  identifier: string
  title: string
  description: string | null
  priority: number
  priorityLabel: string
  url: string
  createdAt: string
  updatedAt: string
  state: { name: string; type: string; color: string }
  assignee: RawIssueUser | null
  team: { id: string; key: string; name: string }
  labels: { nodes: { id: string; name: string; color: string }[] }
  project: { name: string } | null
  cycle: { name: string | null; number: number } | null
  comments: {
    nodes: {
      id: string
      body: string
      createdAt: string
      user: RawIssueUser | null
    }[]
  }
}

export function registerLinearIssueDetailRoute(
  bindingScoped: Hono<{ Variables: LinearWorkspaceVariables }>,
) {
  // Reading issue data still counts as "using this Linear workspace binding",
  // same as the credential handout, so it is gated the same way.
  bindingScoped.get(
    '/issues/:identifier',
    requireLinearMemberAccess(),
    zv('param', issueIdentifierSchema),
    async (c) => {
      const { identifier } = c.req.valid('param')
      const data = await queryBindingGraphql<{ issue: RawIssueDetail | null }>(
        c,
        ISSUE_DETAIL_QUERY,
        { id: identifier },
      )

      if (!data.issue) {
        throw new AppError(
          404,
          'linear_issue_not_found',
          'Linear issue not found or not accessible with this connection',
        )
      }

      const issue = data.issue

      return c.json({
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description,
        priority: issue.priority,
        priorityLabel: issue.priorityLabel,
        url: issue.url,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        state: issue.state,
        assignee: issue.assignee?.name
          ? { name: issue.assignee.name, avatarUrl: issue.assignee.avatarUrl }
          : null,
        team: {
          ...issue.team,
          url: linearTeamUrl(c.get('linearBinding').organizationUrlKey, issue.team.key),
        },
        labels: issue.labels.nodes,
        project: issue.project?.name ?? null,
        cycle: issue.cycle ? (issue.cycle.name ?? `Cycle ${String(issue.cycle.number)}`) : null,
        comments: issue.comments.nodes.map((comment) => ({
          id: comment.id,
          body: comment.body,
          createdAt: comment.createdAt,
          author: comment.user?.name ?? 'Unknown',
          authorAvatarUrl: comment.user?.avatarUrl ?? null,
        })),
      })
    },
  )
}
