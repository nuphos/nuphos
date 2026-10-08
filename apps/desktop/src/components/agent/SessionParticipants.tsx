import { Popover } from '@base-ui/react/popover'
import clsx from 'clsx'
import { Loader2, TriangleAlert, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { LOCAL_AGENT_SHARING_WARNING } from '../../lib/localAgentSharing'
import { Button } from '../ui/button'
import { toast } from '../ui/toast'

import { TIMELINE_CHANGED_EVENT, announceTimelineChange } from './panel/timelineEvents'
import { agentSessionUrl } from './sessionUrl'
import { GeneralAccessRow, RoleMenu } from './ShareAccess'
import {
  AddedReceipt,
  AvatarStack,
  ParticipantList,
  ShareLink,
  TitlebarDragSuspender,
} from './ShareCard'
import { TeammatePicker } from './TeammatePicker'

import type {
  AgentConversationParticipant,
  ConversationAccessState,
  GeneralAccess,
  ParticipantRole,
} from '../../api/agent-types'
import type { TeamMember } from '../../types'

function addLabel(count: number) {
  if (count === 0) return 'Add to session'

  return `Add ${String(count)} ${count === 1 ? 'person' : 'people'}`
}

/**
 * The session's people, and the Share card that decides who else may open it:
 * a team-wide general access plus a role for each invited person, resolved the
 * way Notion does — the broader grant wins. Only the owner changes any of it;
 * everyone else sees who is here and what they may do.
 */
export function SessionParticipants({
  sessionId,
  teamId,
  title,
  currentUserId,
  canManage,
  warnLocalAgent,
}: {
  sessionId: string
  teamId: string
  title: string
  currentUserId: string
  /** The viewer owns this session, so they decide who has access. */
  canManage: boolean
  /** The viewer owns this session and it runs on their own computer's Local Agent. */
  warnLocalAgent: boolean
}) {
  const [participants, setParticipants] = useState<AgentConversationParticipant[]>([])
  const [generalAccess, setGeneralAccess] = useState<GeneralAccess>('none')
  const [inviteRole, setInviteRole] = useState<ParticipantRole>('reply')
  const [members, setMembers] = useState<TeamMember[] | null>(null)
  const [picked, setPicked] = useState<TeamMember[]>([])
  // Set once an invite lands: the card shows its receipt instead of the picker.
  const [added, setAdded] = useState<TeamMember[] | null>(null)
  // 'invite', 'undo', 'access', or the id of the participant being changed.
  const [pending, setPending] = useState<string | null>(null)

  // The pane keys this component by sessionId, so a session switch remounts it
  // and there is no stale list to clear here. An invite from elsewhere (the
  // composer's @mention prompt) announces itself, so the header reloads then.
  useEffect(() => {
    let cancelled = false
    const load = () =>
      api
        .agentGetConversationParticipants(sessionId, teamId)
        .then((result) => {
          if (!cancelled) apply(result)
        })
        .catch((err: unknown) => toast.apiError('Failed to load session participants', err))
    const reloadIfThisSession = (event: Event) => {
      if ((event as CustomEvent<string>).detail === sessionId) void load()
    }

    void load()
    window.addEventListener(TIMELINE_CHANGED_EVENT, reloadIfThisSession)

    return () => {
      cancelled = true
      window.removeEventListener(TIMELINE_CHANGED_EVENT, reloadIfThisSession)
    }
  }, [sessionId, teamId])

  // Every access call answers with the whole state, so the card never merges.
  function apply(result: ConversationAccessState) {
    setParticipants(result.participants)
    setGeneralAccess(result.generalAccess)
  }

  const onOpenChange = (open: boolean) => {
    if (!open) return
    setPicked([])
    setAdded(null)
    if (members) return
    api
      .atlasListTeamMembers(teamId)
      .then(setMembers)
      .catch((err: unknown) => toast.apiError('Failed to load team members', err))
  }

  const togglePicked = (member: TeamMember) =>
    setPicked((current) =>
      current.some((m) => m.id === member.id)
        ? current.filter((m) => m.id !== member.id)
        : [...current, member],
    )

  const invite = () => {
    setPending('invite')
    api
      .agentInviteConversationParticipants(
        sessionId,
        teamId,
        picked.map((member) => member.id),
        inviteRole,
      )
      .then((result) => {
        apply(result)
        setAdded(picked)
        setPicked([])
        announceTimelineChange(sessionId)
      })
      .catch((err: unknown) => toast.apiError('Failed to add teammates', err))
      .finally(() => setPending(null))
  }

  const removeIds = async (ids: string[]) => {
    for (const id of ids) {
      apply(await api.agentRemoveConversationParticipant(sessionId, teamId, id))
    }
    announceTimelineChange(sessionId)
  }

  const remove = (participant: AgentConversationParticipant) => {
    setPending(participant.id)
    removeIds([participant.id])
      .catch((err: unknown) => toast.apiError(`Failed to remove ${participant.name}`, err))
      .finally(() => setPending(null))
  }

  const changeRole = (participant: AgentConversationParticipant, role: ParticipantRole) => {
    setPending(participant.id)
    api
      .agentSetConversationParticipantRole(sessionId, teamId, participant.id, role)
      .then(apply)
      .catch((err: unknown) => toast.apiError(`Failed to change ${participant.name}`, err))
      .finally(() => setPending(null))
  }

  const changeGeneralAccess = (value: GeneralAccess) => {
    setPending('access')
    api
      .agentSetConversationGeneralAccess(sessionId, teamId, value)
      .then(apply)
      .catch((err: unknown) => toast.apiError('Failed to change general access', err))
      .finally(() => setPending(null))
  }

  // Undo takes the people back out and returns them to the picker, so a wrong
  // pick is one click from fixed.
  const undo = () => {
    if (!added) return
    setPending('undo')
    removeIds(added.map((member) => member.id))
      .then(() => {
        setPicked(added)
        setAdded(null)
      })
      .catch((err: unknown) => toast.apiError('Failed to undo', err))
      .finally(() => setPending(null))
  }

  const joined = new Set(participants.map((participant) => participant.id))
  const invitable = (members ?? []).filter((member) => !joined.has(member.id))

  return (
    <Popover.Root onOpenChange={onOpenChange}>
      <Popover.Trigger
        className={clsx(
          'titlebar-no-drag flex h-7 flex-shrink-0 items-center gap-2 rounded-md px-1.5',
          'text-[12px] font-medium text-secondary transition-colors',
          'data-[popup-open]:bg-zGray-800/60 data-[popup-open]:text-main hover:bg-zGray-800/60 hover:text-main',
        )}
        title="Share this session with a teammate"
      >
        <AvatarStack participants={participants} />
        Share
      </Popover.Trigger>
      <Popover.Portal>
        <TitlebarDragSuspender />
        <Popover.Positioner align="end" sideOffset={6} collisionPadding={12} className="z-[1000]">
          <Popover.Popup
            className={(state) =>
              clsx(
                't-dropdown w-[320px] rounded-xl border border-zGray-800/60 bg-main shadow-[0_10px_28px_-6px_rgba(0,0,0,0.6)] outline-none',
                state.open && 'is-open',
                state.transitionStatus === 'ending' && 'is-closing',
              )
            }
            style={{ transformOrigin: 'top right' }}
          >
            {added ? (
              <AddedReceipt
                added={added}
                detail={
                  inviteRole === 'view' && generalAccess !== 'reply'
                    ? 'They can view this session'
                    : 'They can view and reply'
                }
                undoing={pending === 'undo'}
                onUndo={undo}
              />
            ) : (
              <div className="t-share-in flex flex-col gap-3 p-3">
                <div className="flex items-center gap-2 px-1">
                  <Popover.Title className="min-w-0 flex-1 truncate text-[13px] font-medium text-main">
                    Share “{title}”
                  </Popover.Title>
                  <Popover.Close
                    className="rounded p-0.5 text-tertiary hover:bg-zGray-800/60 hover:text-main"
                    aria-label="Close"
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={2} />
                  </Popover.Close>
                </div>
                <ShareLink url={agentSessionUrl(teamId, sessionId)}>
                  <GeneralAccessRow
                    value={generalAccess}
                    canManage={canManage && pending === null}
                    onChange={changeGeneralAccess}
                  />
                </ShareLink>
                {warnLocalAgent && (
                  <div className="flex gap-2 px-1 text-[12px] leading-snug text-warning">
                    <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                    {LOCAL_AGENT_SHARING_WARNING}
                  </div>
                )}
                <ParticipantList
                  participants={participants}
                  currentUserId={currentUserId}
                  generalAccess={generalAccess}
                  canManage={canManage}
                  pending={pending}
                  onRoleChange={changeRole}
                  onRemove={remove}
                />
                {canManage ? (
                  <>
                    <TeammatePicker
                      members={members}
                      invitable={invitable}
                      picked={picked}
                      disabled={pending !== null}
                      onToggle={togglePicked}
                    />
                    <div className="flex items-center gap-2">
                      <RoleMenu value={inviteRole} onChange={setInviteRole} />
                      <Button
                        variant="neutral"
                        size="sm"
                        className="flex-1"
                        disabled={picked.length === 0 || pending !== null}
                        onClick={invite}
                      >
                        {pending === 'invite' && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                        )}
                        {pending === 'invite' ? 'Adding…' : addLabel(picked.length)}
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="px-1 text-[12px] text-tertiary">
                    Only the owner can change who has access.
                  </div>
                )}
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
