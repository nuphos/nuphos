import type { GithubPR } from './onprem-git.ts'

export type GithubPRReview = {
  id: number
  author: string
  authorAvatarUrl: string
  state: string
  body: string | null
  submittedAt: string | null
  htmlUrl: string
}

export type GithubPRComment = {
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
}

export type GithubPRCommit = {
  sha: string
  headline: string
  author: string
  authorAvatarUrl: string
  committedAt: string
  htmlUrl: string
}

export type GithubPRCheck = {
  id: number
  name: string
  status: string
  conclusion: string | null
  detailsUrl: string | null
  appName: string | null
}

export type GithubPRFile = {
  filename: string
  status: string
  additions: number
  deletions: number
  changes: number
  patch: string | null
  previousFilename: string | null
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
  reviews: GithubPRReview[]
  conversation: GithubPRComment[]
  // Absent from backends older than the Desktop client.
  commitHistory?: GithubPRCommit[]
  checks: GithubPRCheck[]
  files: GithubPRFile[]
}

// Pull request writes made through the user's local `gh` login (Electron only).
// `headSha` is the head the user was looking at: reviews and merges are bound
// to it, so GitHub refuses or files them correctly if someone pushed since.
export type GithubPullRef = { owner: string; repo: string; number: number; headSha: string }
export type GithubCliViewer = { login: string; avatarUrl: string }
export type GithubCliResult = { ok: true } | { ok: false; message: string }
export type GithubReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
export type GithubMergeMethod = 'merge' | 'squash' | 'rebase'
