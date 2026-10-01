export type LinearIssueState = {
  name: string
  type: string
  color: string
}

export type LinearIssueAssignee = {
  name: string
  avatarUrl: string | null
}

export type LinearIssueLabel = {
  id: string
  name: string
  color: string
}

export type LinearIssueComment = {
  id: string
  body: string
  createdAt: string
  author: string
  authorAvatarUrl: string | null
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
  state: LinearIssueState
  assignee: LinearIssueAssignee | null
  team: { id: string; key: string; name: string; url: string | null }
  labels: LinearIssueLabel[]
  project: string | null
  cycle: string | null
  comments: LinearIssueComment[]
}

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
  state: LinearIssueState
  assignee: LinearIssueAssignee | null
}

export type LinearTeamIssuesPage = {
  team: Omit<LinearTeamSummary, 'color'>
  issues: LinearIssueRow[]
  nextCursor: string | null
}
