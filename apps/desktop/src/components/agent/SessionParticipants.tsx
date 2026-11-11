import { Popover } from '@base-ui/react/popover'
import clsx from 'clsx'
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { t } from '../../i18n'
import { toast } from '../ui/toast'

import { TIMELINE_CHANGED_EVENT, announceTimelineChange } from './panel/timelineEvents'
import { addableAgents, agentPeople, leaveSession, removePeople } from './channelPeople'
import { ComputerUseConfirm } from './ComputerUseConfirm'
import { needsComputerUse } from './computerUse'
import { InviteSection } from './InviteSection'
import { agentSessionUrl } from './sessionUrl'
import { GeneralAccessRow } from './ShareAccess'
import {
  AddedReceipt,
  ParticipantList,
  ShareButtonFace,
  ShareLink,
  TitlebarDragSuspender,
} from './ShareCard'

import type { ComputerUseRequest } from './computerUse'
import type { Pickable } from './PersonFace'
import type {
  AgentConversationParticipant,
  ChannelAgent,
  ConversationAccessState,
  GeneralAccess,
} from '../../api/agent-types'
import type { TeamMember } from '../../types'

/**
 * The session's people, and the Share card that decides who else sees it.
 * Whoever may use the session's computer replies, so inviting someone who may
 * not asks to give them use of it. Only the owner changes this.
 */
export function SessionParticipants({
  sessionId,
  teamId,
  title,
  currentUserId,
  canManage,
  compact,
  channel,
}: {
  sessionId: string
  teamId: string
  title: string
  currentUserId: string
  /** The viewer owns this session, so they decide who has access. */
  canManage: boolean
  /** A narrow pane header: one avatar and no "Share" label. */
  compact?: boolean
  /** A channel: its agents are listed, picked and removed here like any teammate. */
  channel?: { agents: ChannelAgent[]; ownerId: string; onAgentsChange: () => void }
}) {
  const [participants, setParticipants] = useState<AgentConversationParticipant[]>([])
  const [generalAccess, setGeneralAccess] = useState<GeneralAccess>('none')
  // An invite waiting to also give its people use of the session's computer.
  const [computerUse, setComputerUse] = useState<ComputerUseRequest | null>(null)
  const [members, setMembers] = useState<TeamMember[] | null>(null)
  const [picked, setPicked] = useState<Pickable[]>([])
  // Set once an invite lands: the card shows its receipt instead of the picker.
  const [added, setAdded] = useState<Pickable[] | null>(null)
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
        .catch((err: unknown) => toast.apiError(t('Failed to load agent participants'), err))
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
      .catch((err: unknown) => toast.apiError(t('Failed to load team members'), err))
  }

  const togglePicked = (member: Pickable) =>
    setPicked((current) =>
      current.some((m) => m.id === member.id)
        ? current.filter((m) => m.id !== member.id)
        : [...current, member],
    )

  const invitePeople = (people: Pickable[], grantComputerUse = false) =>
    people.length > 0
      ? api
          .agentInviteConversationParticipants(
            sessionId,
            teamId,
            people.map((member) => member.id),
            grantComputerUse,
          )
          .then(apply)
      : Promise.resolve()

  const invited = () => {
    setAdded(picked)
    setPicked([])
    channel?.onAgentsChange()
    announceTimelineChange(sessionId)
  }

  // Someone who cannot use the computer yet is invited only once the owner confirms giving it.
  const confirmComputerUse = (people: Pickable[], then: () => void) => (err: unknown) => {
    if (!needsComputerUse(err)) return toast.apiError(t('Failed to add teammates'), err)
    setComputerUse({
      count: people.length,
      confirm: () => invitePeople(people, true).then(then),
    })
  }

  const invite = () => {
    const people = picked.filter((member) => !member.agent)

    setPending('invite')
    Promise.all([
      invitePeople(people),
      ...picked
        .filter((member) => member.agent)
        .map((agent) => api.agentAddChannelAgent(sessionId, teamId, agent.id)),
    ])
      .then(invited)
      .catch(confirmComputerUse(people, invited))
      .finally(() => setPending(null))
  }

  // Inviting a participant who reads only again offers them use of the computer.
  const allowReply = (person: AgentConversationParticipant) => {
    setPending(person.id)
    invitePeople([person])
      .catch(confirmComputerUse([person], () => announceTimelineChange(sessionId)))
      .finally(() => setPending(null))
  }

  const removeAll = (people: { id: string; agent?: unknown }[]) =>
    removePeople(people, { sessionId, teamId, apply, onAgentsChange: channel?.onAgentsChange })

  const remove = (person: AgentConversationParticipant) => {
    const { id, name } = person

    setPending(id)
    ;(id === currentUserId ? leaveSession(sessionId, teamId, id) : removeAll([person]))
      .catch((err: unknown) => toast.apiError(t('Failed to remove {name}', { name }), err))
      .finally(() => setPending(null))
  }

  const changeGeneralAccess = (value: GeneralAccess) => {
    setPending('access')
    api
      .agentSetConversationGeneralAccess(sessionId, teamId, value)
      .then(apply)
      .catch((err: unknown) => toast.apiError(t('Failed to change general access'), err))
      .finally(() => setPending(null))
  }

  const undo = () => {
    if (!added) return
    setPending('undo')
    removeAll(added)
      .then(() => {
        setPicked(added)
        setAdded(null)
      })
      .catch((err: unknown) => toast.apiError(t('Failed to undo'), err))
      .finally(() => setPending(null))
  }

  // A channel's agents count as people here, and so do the viewer's own that could join.
  const agents = channel?.agents ?? []
  const everyone = [...participants, ...agentPeople(agents, currentUserId, channel?.ownerId ?? '')]
  const addable = channel ? addableAgents(teamId, currentUserId, agents) : []
  // Anyone may add their own agent; only the owner invites people.
  const invitable: Pickable[] = [
    ...(canManage ? (members ?? []).filter((m) => !participants.some((p) => p.id === m.id)) : []),
    ...addable,
  ]
  const canPick = canManage || addable.length > 0

  return (
    <Popover.Root onOpenChange={onOpenChange}>
      <Popover.Trigger
        className={clsx(
          'titlebar-no-drag flex h-7 flex-shrink-0 items-center gap-2 rounded-md px-1.5',
          'text-[12px] font-medium text-secondary transition-colors',
          'data-[popup-open]:bg-state-selected data-[popup-open]:text-main hover:bg-state-hover hover:text-main',
        )}
        title={t('Share this agent with a teammate')}
      >
        <ShareButtonFace participants={everyone} compact={compact} />
      </Popover.Trigger>
      <Popover.Portal>
        <TitlebarDragSuspender />
        <Popover.Positioner align="end" sideOffset={6} collisionPadding={12} className="z-[1000]">
          <Popover.Popup
            className={(state) =>
              clsx(
                't-dropdown w-[320px] rounded-xl border border-line-control/60 bg-main shadow-[0_10px_28px_-6px_rgba(0,0,0,0.6)] outline-none',
                state.open && 'is-open',
                state.transitionStatus === 'ending' && 'is-closing',
              )
            }
            style={{ transformOrigin: 'top right' }}
          >
            {added ? (
              <AddedReceipt
                added={added}
                detail={t('They can view and reply')}
                undoing={pending === 'undo'}
                onUndo={undo}
              />
            ) : (
              <div className="t-share-in flex flex-col gap-3 p-3">
                <div className="flex items-center gap-2 px-1">
                  <Popover.Title className="min-w-0 flex-1 truncate text-[13px] font-medium text-main">
                    {t('Share “{title}”', { title })}
                  </Popover.Title>
                  <Popover.Close
                    className="rounded p-0.5 text-tertiary hover:bg-state-hover hover:text-main"
                    aria-label={t('Close')}
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={2} />
                  </Popover.Close>
                </div>
                <ShareLink url={agentSessionUrl(teamId, sessionId)}>
                  <GeneralAccessRow
                    value={generalAccess}
                    canManage={canManage && pending === null}
                    chat={channel !== undefined}
                    onChange={changeGeneralAccess}
                  />
                </ShareLink>
                <ParticipantList
                  participants={everyone}
                  label={channel ? t('In this chat') : undefined}
                  currentUserId={currentUserId}
                  canManage={canManage}
                  pending={pending}
                  onAllowReply={allowReply}
                  onRemove={remove}
                />
                {canPick ? (
                  <InviteSection
                    members={members}
                    invitable={invitable}
                    picked={picked}
                    onToggle={togglePicked}
                    chat={channel !== undefined}
                    pending={pending}
                    onInvite={invite}
                  />
                ) : (
                  <div className="px-1 text-[12px] text-tertiary">
                    {t('Only the owner can change who has access.')}
                  </div>
                )}
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
      <ComputerUseConfirm request={computerUse} onClose={() => setComputerUse(null)} />
    </Popover.Root>
  )
}
