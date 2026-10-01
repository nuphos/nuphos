import { ArrowRight } from 'lucide-react'
import { useState } from 'react'

import { InvitationList } from './InvitationList'
import { Modal } from './Modal'
import { toast } from './ui/toast'

import type { TeamInvitation } from '../types'

export type JoinedTeamRef = { id: string; name: string }

type TakeoverProps = {
  invitations: TeamInvitation[]
  /** Accept the invitation; resolves the joined team's id. */
  onAcceptInvitation: (invitationId: string) => Promise<string>
  onRejectInvitation: (invitationId: string) => Promise<void>
  /** Dismiss without finishing ("Later"). Accepted teams stay joined. */
  onClose: () => void
  /** Finish after joining: open the first joined team. */
  onContinue: (teamId: string) => void
}

/**
 * Modal takeover shown to signed-in users when pending invitations arrive —
 * the same card list as onboarding's workspace step in immediate mode, minus
 * the intro reel and setup steps. Mounted only while open; it snapshots the
 * invitation list so accepted cards stay visible as "Joined" instead of
 * vanishing when the parent's pending list refreshes.
 */
export function TeamInvitationsTakeover({
  invitations: initialInvitations,
  onAcceptInvitation,
  onRejectInvitation,
  onClose,
  onContinue,
}: TakeoverProps) {
  const [invitations, setInvitations] = useState(initialInvitations)
  const [joinedTeams, setJoinedTeams] = useState<JoinedTeamRef[]>([])
  const [actingId, setActingId] = useState<string | null>(null)

  async function accept(invitationId: string) {
    if (actingId !== null) return
    const invitation = invitations.find((item) => item.id === invitationId)

    setActingId(invitationId)
    try {
      const teamId = await onAcceptInvitation(invitationId)

      setJoinedTeams((prev) =>
        prev.some((team) => team.id === teamId)
          ? prev
          : [...prev, { id: teamId, name: invitation?.team?.name ?? 'Your workspace' }],
      )
    } catch (e) {
      toast.apiError('Could not accept invitation', e)
    } finally {
      setActingId(null)
    }
  }

  async function reject(invitationId: string) {
    if (actingId !== null) return
    setActingId(invitationId)
    try {
      await onRejectInvitation(invitationId)
      setInvitations((prev) => prev.filter((item) => item.id !== invitationId))
    } catch (e) {
      toast.apiError('Could not reject invitation', e)
    } finally {
      setActingId(null)
    }
  }

  const joinedTeamIds = new Set(joinedTeams.map((team) => team.id))
  const allHandled =
    invitations.length === 0 ||
    invitations.every((invitation) => joinedTeamIds.has(invitation.teamId))

  return (
    <Modal
      open
      onClose={onClose}
      title="Team invitations"
      description="You've been invited to join a workspace."
      footer={
        <div className="flex items-center justify-end gap-2 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="h-8 px-3 rounded-md border border-zGray-800 text-secondary hover:text-main hover:bg-zGray-800/70 text-[12.5px] transition-colors"
          >
            Later
          </button>
          {joinedTeams.length > 0 && (
            <button
              type="button"
              disabled={actingId !== null}
              onClick={() => onContinue(joinedTeams[0]!.id)}
              className="h-8 px-3 rounded-md bg-zViolet-500 hover:bg-zViolet-400 text-white text-[12.5px] font-medium inline-flex items-center gap-1.5 transition-colors disabled:cursor-default disabled:opacity-60"
            >
              Open {joinedTeams[0]!.name}
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          )}
        </div>
      }
    >
      <div className="max-h-[50vh] space-y-2 overflow-y-auto scrollbar-thin p-5">
        {invitations.length === 0 ? (
          <div className="py-2 text-center text-[12.5px] text-tertiary">
            No pending invitations.
          </div>
        ) : (
          <InvitationList
            invitations={invitations}
            joinedTeamIds={joinedTeamIds}
            actingInvitationId={actingId}
            onAcceptInvitation={(id) => void accept(id)}
            onRejectInvitation={(id) => void reject(id)}
            variant="modal"
          />
        )}
        {allHandled && invitations.length > 0 && (
          <div className="pt-1 text-center text-[12px] text-tertiary">
            All set — open a workspace below.
          </div>
        )}
      </div>
    </Modal>
  )
}
