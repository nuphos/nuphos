import { useEffect, useSyncExternalStore } from 'react'

import { api } from '../../../api'

import { githubRef } from './githubRefs'

import type { GithubRef } from './githubRefs'
import type { GithubInstallation } from '../../../types'
import type {
  GithubPRDetail,
  GithubPRReview,
  GithubRefState,
  GithubRefSummary,
} from '../../../types/github-pr-detail'

// Chips re-read a reference they show when it is older than this, so a pull
// request merged since keeps its old state only until the next look.
const STALE_MS = 60_000

export type GithubRefEntry = { summary: GithubRefSummary | null; loading: boolean; at: number }

let entries: ReadonlyMap<string, GithubRefEntry> = new Map()
const listeners = new Set<() => void>()
const installations = new Map<string, Promise<GithubInstallation[]>>()

function setEntry(url: string, entry: GithubRefEntry) {
  entries = new Map(entries).set(url, entry)
  for (const listener of listeners) listener()
}

// Without a signed-in `gh`, a pull request in a repository the team's GitHub
// App can read still resolves through the backend.
function reviewDecision(reviews: GithubPRReview[]): GithubRefSummary['review'] {
  const latest = new Map<string, string>()

  for (const review of reviews) {
    if (review.state === 'APPROVED' || review.state === 'CHANGES_REQUESTED') {
      latest.set(review.author, review.state)
    }
  }
  const states = new Set(latest.values())

  if (states.has('CHANGES_REQUESTED')) return 'changes_requested'

  return states.has('APPROVED') ? 'approved' : null
}

function pullState(pull: GithubPRDetail): GithubRefState {
  if (pull.merged) return 'merged'
  if (pull.state === 'closed') return 'closed'

  return pull.draft ? 'draft' : 'open'
}

async function viaInstallation(ref: GithubRef, teamId: string): Promise<GithubRefSummary | null> {
  let list = installations.get(teamId)

  if (!list) {
    list = api.atlasListGithubInstallations(teamId).catch(() => [])
    installations.set(teamId, list)
  }
  const owner = ref.owner.toLowerCase()
  const installation = (await list).find((i) => i.accountLogin.toLowerCase() === owner)

  if (!installation) return null
  const pull = await api.atlasGetGithubPull(
    teamId,
    installation.installationId,
    ref.owner,
    ref.repo,
    ref.number,
  )
  const state = pullState(pull)

  return {
    kind: 'pull',
    title: pull.title,
    state,
    review: state === 'open' ? reviewDecision(pull.reviews) : null,
  }
}

async function load(ref: GithubRef, teamId: string | undefined) {
  const previous = entries.get(ref.url)

  setEntry(ref.url, { summary: previous?.summary ?? null, loading: true, at: Date.now() })
  let summary: GithubRefSummary | null = null

  try {
    summary = await api.githubCliRefSummary(ref)
    if (!summary && ref.kind === 'pull' && teamId) summary = await viaInstallation(ref, teamId)
  } catch {
    // A chip without details still links to the page; nothing to report.
  }
  setEntry(ref.url, {
    summary: summary ?? previous?.summary ?? null,
    loading: false,
    at: Date.now(),
  })
}

function refresh(ref: GithubRef, teamId: string | undefined) {
  const entry = entries.get(ref.url)

  if (entry?.loading) return
  if (!entry || Date.now() - entry.at > STALE_MS) void load(ref, teamId)
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

const getSnapshot = () => entries

/** The reference's title and state, re-read when stale and when the window regains focus. */
export function useGithubRef(ref: GithubRef, teamId?: string): GithubRefEntry | undefined {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const { url } = ref

  // Keyed by URL: callers rebuild the ref object on every render.
  useEffect(() => {
    const current = githubRef(url)

    if (!current) return
    refresh(current, teamId)
    const onFocus = () => refresh(current, teamId)

    window.addEventListener('focus', onFocus)

    return () => window.removeEventListener('focus', onFocus)
  }, [url, teamId])

  return snapshot.get(url)
}
