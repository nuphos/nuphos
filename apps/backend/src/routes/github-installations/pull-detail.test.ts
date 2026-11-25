import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { Hono } from 'hono'

import { useByosGithub } from '@/lib/test/doubles/byos-github'

import { registerGithubPullDetailRoute } from './pull-detail'

import type { GithubInstallationVariables } from '@/middleware/auth'

useByosGithub({
  getInstallationToken: () => Promise.resolve({ token: 'ghs_team', expiresAt: new Date() }),
})

const SHA = 'abc123'

const pull = {
  number: 7,
  title: 'Fix',
  state: 'open',
  draft: false,
  body: null,
  merged: false,
  mergeable: true,
  mergeable_state: 'clean',
  user: { login: 'octocat', avatar_url: '' },
  labels: [],
  created_at: '2026-11-25T00:00:00Z',
  updated_at: '2026-11-25T00:00:00Z',
  html_url: 'https://github.com/acme/app/pull/7',
  head: { ref: 'fix', sha: SHA },
  base: { ref: 'main', sha: 'def456' },
  additions: 1,
  deletions: 0,
  changed_files: 1,
  commits: 1,
  comments: 0,
  review_comments: 0,
  requested_reviewers: [],
  assignees: [],
  milestone: null,
}

function checkRun(id: number, conclusion: string) {
  return {
    id,
    name: 'backend',
    status: 'completed',
    conclusion,
    details_url: `https://github.com/acme/app/actions/runs/${String(id)}`,
    app: { name: 'GitHub Actions' },
  }
}

function serveGithub(checkRuns: unknown[]) {
  spyOn(globalThis, 'fetch').mockImplementation(((input: string | URL | Request) => {
    const path = new URL(input as string).pathname

    if (path.endsWith('/pulls/7')) return Promise.resolve(Response.json(pull))
    if (path.endsWith(`/commits/${SHA}/check-runs`)) {
      return Promise.resolve(Response.json({ check_runs: checkRuns }))
    }

    return Promise.resolve(Response.json([]))
  }) as typeof fetch)
}

const app = new Hono<{ Variables: GithubInstallationVariables }>()

app.use('*', async (c, next) => {
  c.set('githubInstallationId', 7)
  await next()
})
registerGithubPullDetailRoute(app)

afterEach(() => {
  ;(globalThis.fetch as unknown as { mockRestore?: () => void }).mockRestore?.()
})

describe('GET /repositories/:owner/:repo/pulls/:pullNumber', () => {
  test('lists only the newest run of each check', async () => {
    // The older run was cancelled by `cancel-in-progress` and replaced on the same commit.
    serveGithub([checkRun(100, 'cancelled'), checkRun(200, 'success')])

    const res = await app.request('/repositories/acme/app/pulls/7')
    const body = (await res.json()) as { checks: { id: number; conclusion: string | null }[] }

    expect(res.status).toBe(200)
    expect(body.checks).toEqual([expect.objectContaining({ id: 200, conclusion: 'success' })])
  })
})
