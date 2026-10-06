import { execFile } from 'node:child_process'

import { findExecutable } from './agent/cloud-cli-probe-core.ts'
import { requireNativeConsent } from './consent.ts'
import { resolveShellEnv } from './shell-env.ts'

import type {
  GithubCliResult,
  GithubCliViewer,
  GithubMergeMethod,
  GithubPullRef,
  GithubReviewEvent,
} from '../src/types/github-pr-detail.ts'
import type { WebContents } from 'electron'

// Pull request writes run through the user's own `gh` login, so GitHub records
// them as that person, with that person's permissions. The renderer only gets
// these fixed operations, never a general `gh api` passthrough.

const NAME = /^[\w.-]{1,100}$/
const MAX_BODY = 65_536
const REVIEW_EVENTS = new Set<string>(['APPROVE', 'REQUEST_CHANGES', 'COMMENT'])
const MERGE_METHODS = new Set<string>(['merge', 'squash', 'rebase'])

function pullPath({ owner, repo, number, headSha }: GithubPullRef): string {
  if (
    !NAME.test(owner) ||
    !NAME.test(repo) ||
    !Number.isInteger(number) ||
    number <= 0 ||
    !/^[0-9a-f]{40}$/.test(headSha)
  ) {
    throw new Error('Invalid pull request reference')
  }

  return `repos/${owner}/${repo}`
}

function checkBody(body: string, required: boolean): string {
  if (typeof body !== 'string' || body.length > MAX_BODY) throw new Error('Invalid comment body')
  if (required && !body.trim()) throw new Error('Comment body is empty')

  return body
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function gh(
  method: string,
  path: string,
  payload?: object,
): Promise<{ ok: boolean; json: unknown }> {
  // The user's login-shell PATH, as in the cloud CLI probe: GUI-launched apps
  // do not see Homebrew's bin directory otherwise.
  const env = { ...process.env, ...(await resolveShellEnv()) }

  if (process.platform !== 'win32') {
    env.PATH = `${env.PATH ?? ''}:/opt/homebrew/bin:/usr/local/bin:/usr/bin`
  }
  const { path: executable } = await findExecutable(['gh'], env)

  if (!executable) return { ok: false, json: null }
  const args = ['api', '--hostname', 'github.com', '--method', method, path]

  return new Promise((resolve) => {
    const child = execFile(
      executable,
      payload ? [...args, '--input', '-'] : args,
      { env, timeout: 30_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (error, stdout) => resolve({ ok: !error, json: parseJson(stdout) }),
    )

    child.stdin?.end(payload ? JSON.stringify(payload) : '')
  })
}

// GitHub's own explanation ("Pull Request is not mergeable", "Can not approve
// your own pull request") is what the user needs to see; anything else is a
// local failure with nothing useful to show.
function result({ ok, json }: { ok: boolean; json: unknown }): GithubCliResult {
  if (ok) return { ok: true }
  const message = (json as { message?: unknown } | null)?.message

  return {
    ok: false,
    message: typeof message === 'string' && message ? message : 'GitHub CLI request failed.',
  }
}

/** The account `gh` is signed in to on github.com, or null when gh is missing or signed out. */
export async function githubCliViewer(): Promise<GithubCliViewer | null> {
  const { ok, json } = await gh('GET', 'user')
  const user = json as { login?: unknown; avatar_url?: unknown } | null

  if (!ok || typeof user?.login !== 'string') return null

  return {
    login: user.login,
    avatarUrl: typeof user.avatar_url === 'string' ? user.avatar_url : '',
  }
}

export async function githubCliComment(
  pull: GithubPullRef,
  body: string,
): Promise<GithubCliResult> {
  return result(
    await gh('POST', `${pullPath(pull)}/issues/${String(pull.number)}/comments`, {
      body: checkBody(body, true),
    }),
  )
}

export async function githubCliReview(
  pull: GithubPullRef,
  event: GithubReviewEvent,
  body: string,
): Promise<GithubCliResult> {
  if (!REVIEW_EVENTS.has(event)) throw new Error('Invalid review event')

  return result(
    await gh('POST', `${pullPath(pull)}/pulls/${String(pull.number)}/reviews`, {
      event,
      // Without it GitHub files the review against whatever the head is now,
      // which may be a commit pushed after the reviewer loaded the page.
      commit_id: pull.headSha,
      // GitHub rejects an empty body on REQUEST_CHANGES and COMMENT reviews.
      body: checkBody(body, event !== 'APPROVE'),
    }),
  )
}

export async function githubCliMerge(
  sender: WebContents,
  pull: GithubPullRef,
  method: GithubMergeMethod,
): Promise<GithubCliResult> {
  const path = pullPath(pull)

  if (!MERGE_METHODS.has(method)) throw new Error('Invalid merge method')
  // A merge cannot be undone from here, so the confirmation lives where a
  // compromised renderer cannot click it.
  const confirmed = await requireNativeConsent(sender, {
    title: 'Merge pull request?',
    message: `Merge ${pull.owner}/${pull.repo}#${String(pull.number)} using your GitHub CLI account?`,
    detail: `Method: ${method}. GitHub will record this merge as your account, not Nuphos.`,
    confirmLabel: 'Merge',
  })

  if (!confirmed) return { ok: false, message: 'Merge cancelled.' }

  // `sha` makes GitHub refuse the merge if someone pushed after this page loaded.
  return result(
    await gh('PUT', `${path}/pulls/${String(pull.number)}/merge`, {
      merge_method: method,
      sha: pull.headSha,
    }),
  )
}
