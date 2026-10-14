import type { Part } from './parts.ts'
import type { GithubRefKey } from '../../../types/github-pr-detail.ts'

export type GithubRef = GithubRefKey & { kind: 'pull' | 'issue'; url: string }

const NAME = /^[\w.-]{1,100}$/
const URL_IN_TEXT = /https:\/\/github\.com\/[^\s"'`<>()[\]{}\\]+/gi
// A tool that printed more than this many pull requests or issues was listing
// them; a chip row would pick some at random.
const MAX_REFS_PER_TOOL = 2
const MAX_TOOL_REFS = 3

/** A github.com pull request or issue URL, including its tabs (`/files`) and anchors. */
export function githubRef(raw: string): GithubRef | null {
  let url: URL

  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') return null
  const [owner, repo, segment, num] = url.pathname.split('/').filter(Boolean)
  const kind = segment === 'pull' ? 'pull' : segment === 'issues' ? 'issue' : null
  const number = Number(num)

  if (!kind || !NAME.test(owner ?? '') || !NAME.test(repo ?? '')) return null
  if (!Number.isInteger(number) || number <= 0 || String(number) !== num) return null

  return {
    owner,
    repo,
    number,
    kind,
    url: `https://github.com/${owner}/${repo}/${segment}/${num}`,
  }
}

/** Link text that only restates the reference (the URL, `#12`, `owner/repo#12`). */
export function isBareGithubLink(ref: GithubRef, text: string): boolean {
  const value = text.trim().replace(/\/$/, '')

  if (value === ref.url || githubRef(value)?.url === ref.url) return true

  return value === `#${ref.number}` || value === `${ref.owner}/${ref.repo}#${ref.number}`
}

function refsIn(text: string): GithubRef[] {
  const refs = new Map<string, GithubRef>()

  for (const match of text.matchAll(URL_IN_TEXT)) {
    const ref = githubRef(match[0])

    if (ref) refs.set(ref.url, ref)
  }

  return [...refs.values()]
}

function toolText(output: unknown): string {
  if (output === undefined) return ''

  return typeof output === 'string' ? output : JSON.stringify(output)
}

/** Pull requests and issues the turn's tools returned that the answer never links. */
export function turnGithubRefs(parts: readonly Part[]): GithubRef[] {
  const mentioned = new Set<string>()
  const found = new Map<string, GithubRef>()

  for (const part of parts) {
    if (part.type === 'text') {
      for (const ref of refsIn(part.text)) mentioned.add(ref.url)
    }
    if (part.type !== 'tool' || part.state !== 'output-available') continue
    const refs = refsIn(toolText(part.output))

    if (refs.length > MAX_REFS_PER_TOOL) continue
    for (const ref of refs) found.set(ref.url, ref)
  }

  return [...found.values()].filter((ref) => !mentioned.has(ref.url)).slice(0, MAX_TOOL_REFS)
}
