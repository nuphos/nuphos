import type { GithubRefState, GithubRefSummary } from '../src/types/github-pr-detail.ts'

// One fixed read for a chat chip: the title, state and review decision of a
// pull request or issue, as the user's own `gh` login can see it.
export const REF_SUMMARY_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issueOrPullRequest(number: $number) {
      __typename
      ... on PullRequest { title state isDraft reviewDecision }
      ... on Issue { title state stateReason }
    }
  }
}`

type Node = {
  __typename?: unknown
  title?: unknown
  state?: unknown
  isDraft?: unknown
  reviewDecision?: unknown
  stateReason?: unknown
}

const PULL_STATE: Partial<Record<string, GithubRefState>> = { MERGED: 'merged', CLOSED: 'closed' }
const REVIEW: Partial<Record<string, NonNullable<GithubRefSummary['review']>>> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes_requested',
}

function pullSummary(node: Node, title: string): GithubRefSummary {
  const state = PULL_STATE[String(node.state)] ?? (node.isDraft === true ? 'draft' : 'open')
  // A review decision only matters while the pull request can still change.
  const review = state === 'open' ? (REVIEW[String(node.reviewDecision)] ?? null) : null

  return { kind: 'pull', title, state, review }
}

function issueState(node: Node): GithubRefState {
  if (node.state === 'OPEN') return 'open'

  return node.stateReason === 'NOT_PLANNED' ? 'not_planned' : 'completed'
}

export function parseRefSummary(json: unknown): GithubRefSummary | null {
  const node = (
    json as { data?: { repository?: { issueOrPullRequest?: Node | null } | null } } | null
  )?.data?.repository?.issueOrPullRequest

  if (!node || typeof node.title !== 'string') return null
  if (node.__typename === 'PullRequest') return pullSummary(node, node.title)
  if (node.__typename !== 'Issue') return null

  return { kind: 'issue', title: node.title, state: issueState(node), review: null }
}
