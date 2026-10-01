import { z } from 'zod'

import { GithubApiError, getInstallationToken } from '@/lib/byos/github'
import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'
import { handleGithubError } from '@/routes/github-installations/shared'

import { registerGithubPullDetailRoute } from './pull-detail'

import type { GithubInstallationVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

const pullsQuerySchema = z.object({
  state: z.enum(['open', 'closed', 'all']).default('open'),
  per_page: z.coerce.number().int().min(1).max(100).default(30),
  page: z.coerce.number().int().min(1).default(1),
})

const repoParamSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
})

const runsQuerySchema = z.object({
  per_page: z.coerce.number().int().min(1).max(100).default(30),
  page: z.coerce.number().int().min(1).default(1),
})

export function registerGithubRepoDataRoutes(
  installationScoped: Hono<{ Variables: GithubInstallationVariables }>,
) {
  registerGithubPullDetailRoute(installationScoped)

  installationScoped.get(
    '/repositories/:owner/:repo/pulls',
    zv('param', repoParamSchema),
    zv('query', pullsQuerySchema),
    async (c) => {
      const installationId = c.get('githubInstallationId')
      const { owner, repo } = c.req.valid('param')
      const { state, per_page, page } = c.req.valid('query')

      try {
        const { token } = await getInstallationToken(installationId)
        const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=${state}&per_page=${String(per_page)}&page=${String(page)}`
        const res = await fetch(url, {
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
            `GitHub API pulls failed: ${String(res.status)} ${text}`,
          )
        }
        const raw = (await res.json()) as {
          number: number
          title: string
          state: string
          draft: boolean
          user: { login: string; avatar_url: string } | null
          labels: { name: string; color: string }[]
          created_at: string
          updated_at: string
          html_url: string
          head: { ref: string }
          base: { ref: string }
        }[]
        const pulls = raw.map((pr) => ({
          number: pr.number,
          title: pr.title,
          state: pr.state,
          draft: pr.draft,
          author: pr.user?.login ?? null,
          authorAvatarUrl: pr.user?.avatar_url ?? null,
          labels: pr.labels.map((l) => ({ name: l.name, color: l.color })),
          createdAt: pr.created_at,
          updatedAt: pr.updated_at,
          htmlUrl: pr.html_url,
          headRef: pr.head.ref,
          baseRef: pr.base.ref,
        }))

        return c.json({ pulls })
      } catch (e) {
        if (e instanceof GithubApiError) {
          if (e.status === 404)
            throw new AppError(
              404,
              'repo_not_found',
              'Repository not found or not accessible to this installation',
            )
          if (e.status === 403)
            throw new AppError(
              403,
              'repo_forbidden',
              'Installation does not have pull request access to this repository',
            )
        }
        handleGithubError(e, 'Failed to list pull requests')
      }
    },
  )

  installationScoped.get(
    '/repositories/:owner/:repo/actions/runs',
    zv('param', repoParamSchema),
    zv('query', runsQuerySchema),
    async (c) => {
      const installationId = c.get('githubInstallationId')
      const { owner, repo } = c.req.valid('param')
      const { per_page, page } = c.req.valid('query')

      try {
        const { token } = await getInstallationToken(installationId)
        const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs?per_page=${String(per_page)}&page=${String(page)}`
        const res = await fetch(url, {
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
            `GitHub API actions/runs failed: ${String(res.status)} ${text}`,
          )
        }
        const raw = (await res.json()) as {
          total_count: number
          workflow_runs: {
            id: number
            name: string | null
            status: string | null
            conclusion: string | null
            event: string
            head_branch: string | null
            head_sha: string
            created_at: string
            updated_at: string
            html_url: string
          }[]
        }
        const runs = raw.workflow_runs.map((r) => ({
          id: r.id,
          name: r.name,
          status: r.status,
          conclusion: r.conclusion,
          event: r.event,
          headBranch: r.head_branch,
          headSha: r.head_sha,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          htmlUrl: r.html_url,
        }))

        return c.json({ runs, totalCount: raw.total_count })
      } catch (e) {
        if (e instanceof GithubApiError) {
          if (e.status === 404)
            throw new AppError(
              404,
              'repo_not_found',
              'Repository not found or not accessible to this installation',
            )
          if (e.status === 403)
            throw new AppError(
              403,
              'repo_forbidden',
              'Installation does not have Actions access to this repository',
            )
        }
        handleGithubError(e, 'Failed to list workflow runs')
      }
    },
  )
}
