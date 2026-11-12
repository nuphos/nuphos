import { AppError } from '@/lib/errors'

export type GithubSkillSource = {
  owner: string
  repo: string
  /** Branch, tag or commit; null means the default branch. */
  ref: string | null
  /** Folder inside the repository to search, without leading or trailing slashes. */
  subpath: string | null
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const REPO = /^[A-Za-z0-9._-]{1,100}$/
const REF = /^[A-Za-z0-9._/-]{1,200}$/

function invalid(message: string): never {
  throw new AppError(400, 'invalid_source', message)
}

function checkRepo(owner: string, repo: string): string {
  if (!OWNER.test(owner) || !REPO.test(repo) || /^\.+$/.test(repo))
    invalid('expected owner/repo or a github.com URL')

  return repo
}

function cleanSubpath(raw: string | undefined): string | null {
  const parts = (raw ?? '').split('/').filter(Boolean)

  if (parts.some((part) => part === '.' || part === '..'))
    invalid('path must stay inside the repository')

  return parts.length ? parts.join('/') : null
}

function cleanRef(raw: string | undefined): string | null {
  if (!raw) return null
  if (!REF.test(raw) || raw.includes('..') || raw.startsWith('/') || raw.endsWith('/'))
    invalid(`invalid ref: ${raw}`)

  return raw
}

const GITHUB_HOST = /^(?:https?:\/\/)?(?:www\.)?github\.com\//i

function stripGithubUrl(input: string): { path: string; tree: boolean } | null {
  const host = GITHUB_HOST.exec(input)

  if (!host) return null
  const path = input.slice(host[0].length).split(/[?#]/, 1)[0] ?? ''
  const [owner, repo, kind, ...rest] = path.split('/').filter(Boolean)

  if (kind === 'tree' || kind === 'blob')
    return { path: [owner, repo, ...rest].join('/'), tree: true }

  return { path: [owner, repo].join('/'), tree: false }
}

/**
 * Parses the GitHub forms `npx skills add` accepts: `owner/repo[/path][#ref]`,
 * `https://github.com/owner/repo` and `.../tree/<ref>/<path>`. As there, the
 * first segment after `/tree/` is the ref; a ref with slashes uses `#ref`.
 */
export function parseGithubSource(raw: string): GithubSkillSource {
  const [location = '', ...fragment] = raw.trim().split('#')
  const fragmentRef = fragment.length ? fragment.join('#') : undefined
  const body = location.replace(/^github:/, '')
  const url = stripGithubUrl(body)

  if (!url && /^[a-z]+:\/\//i.test(body)) invalid('only github.com sources are supported')
  const [owner = '', rawRepo = '', ...rest] = (url?.path ?? body).split('/').filter(Boolean)
  const repo = checkRepo(owner, rawRepo.replace(/\.git$/, ''))
  const treeRef = url?.tree ? rest.shift() : undefined

  if (rest.at(-1) === 'SKILL.md') rest.pop()

  return {
    owner,
    repo,
    ref: cleanRef(fragmentRef ?? treeRef),
    subpath: cleanSubpath(rest.join('/')),
  }
}

export const githubSourceLabel = (source: GithubSkillSource): string =>
  `${source.owner}/${source.repo}`
