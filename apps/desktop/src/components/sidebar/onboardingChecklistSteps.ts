// Step definitions and per-team localStorage persistence for the sidebar
// onboarding checklist (SidebarOnboardingChecklist.tsx renders them).

// Historically this key stored a permanent dismissal; it now means "collapsed",
// so previously-dismissed teams show the compact row instead of nothing.
export const COLLAPSE_KEY = (teamId: string) => `nuphos.onboarding-checklist.dismissed.${teamId}`
export const VISITED_KEY = (teamId: string) => `nuphos.onboarding-checklist.visited.${teamId}`

export function readVisited(teamId: string): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(VISITED_KEY(teamId))
    const parsed: unknown = raw ? JSON.parse(raw) : []

    return new Set(Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

export function persist(key: string, value: string) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(key, value)
  } catch {
    // storage unavailable — the checklist just won't remember; harmless.
  }
}

export function readCollapsed(teamId: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(COLLAPSE_KEY(teamId)) === '1'
  } catch {
    return false
  }
}

export type StepDef = {
  id: string
  label: string
  description: string
  navKey: string
  /** Whether opening this step counts as completing it (the chat step). Step 1's
   *  completion is the real integration state and step 3's is the real member
   *  count, so neither is click-completed. */
  completeOnOpen: boolean
}

// The steps are numbered to suggest an order, not to gate one: every step is
// reachable at any time. Locking later steps behind step 1 would strand them
// forever — `isDone` reports step 1 as never done, because connecting a cloud
// unmounts this whole widget. Nor are the steps truly dependent: a newcomer can
// ask the agent something or invite a teammate before any cloud is linked.

export const STEPS: StepDef[] = [
  {
    id: 'integrate',
    label: 'Connect your cloud assets',
    description: 'Link a cloud account so Nuphos can manage it.',
    navKey: 'team.integrations',
    completeOnOpen: false,
  },
  {
    id: 'chat',
    label: 'Ask the agent your first question',
    description: 'Deploy, debug, or query in plain language.',
    navKey: 'team.agent',
    completeOnOpen: true,
  },
  {
    id: 'invite',
    label: 'Invite your team',
    description: 'Collaborate with teammates on your infrastructure.',
    navKey: 'team.members',
    completeOnOpen: false,
  },
]
