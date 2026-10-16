import type { AtlasTeam, TeamInvitation, UserInfo } from '../../../types'

export type OnboardingFlowProps = {
  user: UserInfo
  /**
   * Whether the user can dismiss onboarding without finishing. True only when
   * onboarding was forced open for debugging (`window.onboarding()`); a genuine
   * new user must create a workspace before they can use the app.
   */
  dismissable: boolean
  /** Close without finishing — dev/debug escape hatch only. */
  onClose: () => void
  /** Create the first workspace (wraps atlasCreateTeam + adopts it as active). */
  onCreateWorkspace: (name: string) => Promise<AtlasTeam>
  /**
   * Pending workspace invitations offered in the workspace step as an
   * alternative to creating one. Accepting joins the team and finishes
   * onboarding.
   */
  pendingInvitations?: TeamInvitation[]
  /** Accept an invitation; resolves the joined team's id. */
  onAcceptInvitation?: (invitationId: string) => Promise<string>
  /**
   * Join a workspace advertising the user's email domain (discoverable teams
   * are fetched here, mirroring CreateOrJoinTeamView). Joining finishes
   * onboarding the same way accepting an invitation does.
   */
  onJoinDiscoverableTeam?: (teamId: string) => Promise<void>
  /**
   * Sign out from inside the (non-dismissable) overlay — the escape hatch for
   * "this invitation went to my other account" situations.
   */
  onLogout?: () => void
  /** Finish onboarding and land in the app on the given team (if any). */
  onFinish: (teamId: string | null) => void
}

// The onboarding conversation asks for a workspace name, then shows it being
// created; a new workspace hands over to the agent setup, a joined one lands
// straight in the app.
export type ChatStep = 'workspace' | 'creating'

export const EASE_OUT = [0.22, 1, 0.36, 1] as const

// Display handle for greetings and defaults: the first token of the user's
// name, with the domain stripped when that name is just an email address —
// "sam+1@example.com" greets as "sam+1", never the full address.
export function deriveFirstName(user: UserInfo): string {
  const first = (user.name || user.username || '').trim().split(/\s+/)[0] ?? ''

  return first.includes('@') ? first.slice(0, first.indexOf('@')) : first
}

export function deriveDefaultWorkspaceName(user: UserInfo): string {
  const first = deriveFirstName(user)

  return first ? `${first}'s Workspace` : 'My Workspace'
}
