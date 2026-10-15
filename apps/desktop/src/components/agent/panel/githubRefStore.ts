import { useEffect, useSyncExternalStore } from 'react'

import { api } from '../../../api'
import { createLimiter } from '../../../lib/limiter'

import { reviewers } from '../../../views/github-repo/pullRequestStatus'

import { githubRef } from './githubRefs'

import type { GithubRef } from './githubRefs'
import type { GithubInstallation } from '../../../types'
import type {
  GithubPRDetail,
  GithubRefState,
  GithubRefSummary,
} from '../../../types/github-pr-detail'

// Chips re-read a reference they show when it is older than this, so a pull
// request merged since keeps its old state only until the next look.
const STALE_MS = 60_000
// Each read is a `gh` process; a transcript full of links queues instead of spawning them all.
const MAX_IN_FLIGHT = 2
// A merged or closed reference does not change on its own, so it is read once.
const SETTLED = new Set<GithubRefState>(['merged', 'closed', 'completed', 'not_planned'])

export type GithubRefEntry = { summary: GithubRefSummary | null; loading: boolean; at: number }

let entries: ReadonlyMap<string, GithubRefEntry> = new Map()
const listeners = new Set<() => void>()
const installations = new Map<string, Promise<GithubInstallation[]>>()
const limited = createLimiter(MAX_IN_FLIGHT)

function setEntry(url: string, entry: GithubRefEntry) {
  entries = new Map(entries).set(url, entry)
  for (const listener of listeners) listener()
}

// The PR page's review rules: latest decision per reviewer, and a fresh review
// request puts that reviewer back to pending.
function reviewDecision(pull: GithubPRDetail): GithubRefSummary['review'] {
  const states = new Set(reviewers(pull).map((reviewer) => reviewer.state))

  if (states.has('changes_requested')) return 'changes_requested'

  return states.has('approved') && !states.has('pending') ? 'approved' : null
}

function pullState(pull: GithubPRDetail): GithubRefState {
  if (pull.merged) return 'merged'
  if (pull.state === 'closed') return 'closed'

  return pull.draft ? 'draft' : 'open'
}

// Without a signed-in `gh`, a pull request in a repository the team's GitHub
// App can read still resolves through the backend.
async function viaInstallation(ref: GithubRef, teamId: string): Promise<GithubRefSummary | null> {
  let list = installations.get(teamId)

  if (!list) {
    // A failed lookup is not cached, so the next refresh tries again.
    list = api.atlasListGithubInstallations(teamId).catch(() => {
      installations.delete(teamId)

      return []
    })
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
    review: state === 'open' ? reviewDecision(pull) : null,
  }
}

async function load(ref: GithubRef, teamId: string | undefined) {
  const previous = entries.get(ref.url)
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
  if (entry?.summary && SETTLED.has(entry.summary.state)) return
  if (entry && Date.now() - entry.at <= STALE_MS) return
  // Marked loading while queued, so other chips for the same link wait for this read.
  setEntry(ref.url, { summary: entry?.summary ?? null, loading: true, at: Date.now() })
  limited(() => load(ref, teamId))
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

const getSnapshot = () => entries

/** The reference's title and state, re-read when stale (unless settled) and when the window regains focus. */
export function useGithubRef(ref: GithubRef, teamId?: string): GithubRefEntry | undefined {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const { url } = ref

  // Keyed by URL: callers rebuild the ref object on every render.
  useEffect(() => {
    const current = githubRef(url)

    if (!current) return
    refresh(current, teamId)
    const onFocus = () => refresh(current, teamId)
    // Also re-read on the clock, for a chip that stays on screen in a focused window.
    const timer = window.setInterval(() => refresh(current, teamId), STALE_MS)

    window.addEventListener('focus', onFocus)

    return () => {
      window.removeEventListener('focus', onFocus)
      window.clearInterval(timer)
    }
  }, [url, teamId])

  return snapshot.get(url)
}
