import { z } from 'zod'

import { GithubApiError, getInstallationToken } from '@/lib/byos/github'
import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'
import { handleGithubError } from '@/routes/github-installations/shared'

import type { GithubInstallationVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

const pullParamSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  pullNumber: z.coerce.number().int().positive(),
})

type User = { login: string; avatar_url: string }

type RawPull = {
  number: number
  title: string
  state: 'open' | 'closed'
  draft: boolean
  body: string | null
  merged: boolean
  mergeable: boolean | null
  mergeable_state: string
  user: User | null
  labels: { name: string; color: string }[]
  created_at: string
  updated_at: string
  html_url: string
  head: { ref: string; sha: string }
  base: { ref: string; sha: string }
  additions: number
  deletions: number
  changed_files: number
  commits: number
  comments: number
  review_comments: number
  requested_reviewers: User[]
  assignees: User[]
  milestone: { title: string } | null
}

type RawReview = {
  id: number
  user: User | null
  state: string
  body: string | null
  submitted_at: string | null
  html_url: string
}

type RawComment = {
  id: number
  user: User | null
  body: string
  created_at: string
  updated_at: string
  html_url: string
  path?: string
  line?: number | null
  original_line?: number | null
  diff_hunk?: string
}

type RawCommit = {
  sha: string
  html_url: string
  author: User | null
  commit: {
    message: string
    author: { name: string } | null
    committer: { date: string } | null
  }
}

type RawFile = {
  filename: string
  status: string
  additions: number
  deletions: number
  changes: number
  patch?: string
  previous_filename?: string
}

type RawChecks = {
  check_runs: {
    id: number
    name: string
    status: string
    conclusion: string | null
    details_url: string | null
    app: { name: string } | null
  }[]
}

function githubJsonFor(token: string, base: string) {
  return async <T>(path: string): Promise<T> => {
    const res = await fetch(`${base}${path}`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'nuphos-backend',
      },
      signal: AbortSignal.timeout(30_000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')

      throw new GithubApiError(
        res.status,
        `GitHub API request failed: ${String(res.status)} ${text}`,
      )
    }

    return (await res.json()) as T
  }
}

export function registerGithubPullDetailRoute(
  installationScoped: Hono<{ Variables: GithubInstallationVariables }>,
) {
  installationScoped.get(
    '/repositories/:owner/:repo/pulls/:pullNumber',
    zv('param', pullParamSchema),
    async (c) => {
      const installationId = c.get('githubInstallationId')
      const { owner, repo, pullNumber } = c.req.valid('param')
      const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`

      try {
        const { token } = await getInstallationToken(installationId)
        const githubJson = githubJsonFor(token, base)
        const pr = await githubJson<RawPull>(`/pulls/${String(pullNumber)}`)
        const checks = githubJson<RawChecks>(
          `/commits/${encodeURIComponent(pr.head.sha)}/check-runs?per_page=100`,
        ).catch((error: unknown) => {
          // Checks permission is separate from pull-request metadata. A GitHub
          // App without it should still be able to render the rest of the PR.
          if (error instanceof GithubApiError && (error.status === 403 || error.status === 404)) {
            return { check_runs: [] }
          }
          throw error
        })
        const [rawReviews, rawComments, rawReviewComments, rawCommits, rawFiles, rawChecks] =
          await Promise.all([
            githubJson<RawReview[]>(`/pulls/${String(pullNumber)}/reviews?per_page=100`),
            githubJson<RawComment[]>(`/issues/${String(pullNumber)}/comments?per_page=100`),
            githubJson<RawComment[]>(`/pulls/${String(pullNumber)}/comments?per_page=100`),
            githubJson<RawCommit[]>(`/pulls/${String(pullNumber)}/commits?per_page=100`),
            githubJson<RawFile[]>(`/pulls/${String(pullNumber)}/files?per_page=100`),
            checks,
          ])
        const conversation = [...rawComments, ...rawReviewComments].sort((a, b) =>
          a.created_at.localeCompare(b.created_at),
        )

        return c.json({
          number: pr.number,
          title: pr.title,
          state: pr.state,
          draft: pr.draft,
          body: pr.body,
          merged: pr.merged,
          mergeable: pr.mergeable,
          mergeableState: pr.mergeable_state,
          author: pr.user?.login ?? 'ghost',
          authorAvatarUrl: pr.user?.avatar_url ?? '',
          labels: pr.labels.map((label) => ({ name: label.name, color: label.color })),
          createdAt: pr.created_at,
          updatedAt: pr.updated_at,
          htmlUrl: pr.html_url,
          headRef: pr.head.ref,
          baseRef: pr.base.ref,
          headSha: pr.head.sha,
          baseSha: pr.base.sha,
          additions: pr.additions,
          deletions: pr.deletions,
          changedFiles: pr.changed_files,
          commits: pr.commits,
          comments: pr.comments,
          reviewComments: pr.review_comments,
          requestedReviewers: pr.requested_reviewers.map((user) => ({
            login: user.login,
            avatarUrl: user.avatar_url,
          })),
          assignees: pr.assignees.map((user) => ({
            login: user.login,
            avatarUrl: user.avatar_url,
          })),
          milestone: pr.milestone?.title ?? null,
          reviews: rawReviews.map((review) => ({
            id: review.id,
            author: review.user?.login ?? 'ghost',
            authorAvatarUrl: review.user?.avatar_url ?? '',
            state: review.state,
            body: review.body,
            submittedAt: review.submitted_at,
            htmlUrl: review.html_url,
          })),
          conversation: conversation.map((comment) => ({
            id: comment.id,
            author: comment.user?.login ?? 'ghost',
            authorAvatarUrl: comment.user?.avatar_url ?? '',
            body: comment.body,
            createdAt: comment.created_at,
            updatedAt: comment.updated_at,
            htmlUrl: comment.html_url,
            path: comment.path,
            line: comment.line ?? comment.original_line,
            diffHunk: comment.diff_hunk,
          })),
          commitHistory: rawCommits.map((commit) => ({
            sha: commit.sha,
            headline: commit.commit.message.split('\n')[0],
            author: commit.author?.login ?? commit.commit.author?.name ?? 'ghost',
            authorAvatarUrl: commit.author?.avatar_url ?? '',
            committedAt: commit.commit.committer?.date ?? pr.created_at,
            htmlUrl: commit.html_url,
          })),
          checks: rawChecks.check_runs.map((check) => ({
            id: check.id,
            name: check.name,
            status: check.status,
            conclusion: check.conclusion,
            detailsUrl: check.details_url,
            appName: check.app?.name ?? null,
          })),
          files: rawFiles.map((file) => ({
            filename: file.filename,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
            changes: file.changes,
            patch: file.patch ?? null,
            previousFilename: file.previous_filename ?? null,
          })),
        })
      } catch (error) {
        if (error instanceof GithubApiError) {
          if (error.status === 404)
            throw new AppError(
              404,
              'pull_not_found',
              'Pull request not found or not accessible to this installation',
            )
          if (error.status === 403)
            throw new AppError(
              403,
              'pull_forbidden',
              'Installation does not have pull request access to this repository',
            )
        }
        handleGithubError(error, 'Failed to load pull request')
      }
    },
  )
}
