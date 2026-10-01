import clsx from 'clsx'
import { Check, Link2, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { api } from '../../api'
import { Avatar } from '../Avatar'
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from '../ui/menu'
import { toast } from '../ui/toast'

import type { AgentConversationParticipant } from '../../api/agent-types'
import type { TeamMember } from '../../types'

const AVATAR_SIZE = 22
// Reuse the ring the IAM avatar group uses, recoloured for the agent titlebar so
// overlapping avatars read as separate discs.
const AVATAR_CHROME = 'shrink-0 !rounded-full border-2 border-agentCanvas !shadow-none'
const VISIBLE_AVATARS = 3

function AvatarStack({ participants }: { participants: AgentConversationParticipant[] }) {
  if (participants.length === 0) return null
  const hidden = participants.length - VISIBLE_AVATARS

  return (
    <span className="flex -space-x-1.5">
      {participants.slice(0, VISIBLE_AVATARS).map((participant) => (
        <Avatar
          key={participant.id}
          src={participant.avatarURL}
          name={participant.name}
          size={AVATAR_SIZE}
          className={clsx(AVATAR_CHROME, participant.deactivated && 'opacity-50')}
        />
      ))}
      {hidden > 0 && (
        <span
          className={clsx(
            AVATAR_CHROME,
            'flex items-center justify-center bg-zGray-800 text-[10px] text-secondary',
          )}
          style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}
        >
          +{hidden}
        </span>
      )}
    </span>
  )
}

/**
 * The session's people, and the Share menu that brings more of them in. Every
 * member of the team can already open and reply to a team session, so inviting
 * grants nothing — it records that someone belongs here, which is what puts
 * them in this header for everyone else.
 */
export function SessionParticipants({
  sessionId,
  teamId,
  currentUserId,
  onCopyLink,
  copied,
}: {
  sessionId: string
  teamId: string
  currentUserId: string
  onCopyLink: () => void
  copied: boolean
}) {
  const [participants, setParticipants] = useState<AgentConversationParticipant[]>([])
  const [members, setMembers] = useState<TeamMember[] | null>(null)
  const [inviting, setInviting] = useState<string | null>(null)

  // The pane keys this component by sessionId, so a session switch remounts it
  // and there is no stale list to clear here.
  useEffect(() => {
    let cancelled = false

    api
      .agentGetConversationParticipants(sessionId, teamId)
      .then((result) => {
        if (!cancelled) setParticipants(result.participants)
      })
      .catch((err: unknown) => toast.apiError('Failed to load session participants', err))

    return () => {
      cancelled = true
    }
  }, [sessionId, teamId])

  const loadMembers = useCallback(() => {
    if (members) return
    api
      .atlasListTeamMembers(teamId)
      .then(setMembers)
      .catch((err: unknown) => toast.apiError('Failed to load team members', err))
  }, [members, teamId])

  const invite = useCallback(
    (member: TeamMember) => {
      setInviting(member.id)
      api
        .agentInviteConversationParticipants(sessionId, teamId, [member.id])
        .then((result) => setParticipants(result.participants))
        .catch((err: unknown) => toast.apiError(`Failed to add ${member.name}`, err))
        .finally(() => setInviting(null))
    },
    [sessionId, teamId],
  )

  const joined = new Set(participants.map((participant) => participant.id))
  const invitable = (members ?? []).filter((member) => !joined.has(member.id))

  return (
    <Menu onOpenChange={(open) => open && loadMembers()}>
      <MenuTrigger
        className={clsx(
          'titlebar-no-drag flex h-7 flex-shrink-0 items-center gap-2 rounded-md px-1.5',
          'text-[12px] font-medium text-secondary transition-colors',
          'data-[popup-open]:bg-zGray-800/60 data-[popup-open]:text-main hover:bg-zGray-800/60 hover:text-main',
        )}
        title="Share this session with a teammate"
      >
        <AvatarStack participants={participants} />
        Share
      </MenuTrigger>
      <MenuContent align="end" className="w-[260px]">
        {/* Base UI reads a group label out of its group's context, so every
            label has to sit inside a MenuGroup — outside one it throws. */}
        <MenuGroup>
          <MenuGroupLabel>In this session</MenuGroupLabel>
          {participants.map((participant) => (
            <MenuItem
              key={participant.id}
              closeOnClick={false}
              icon={
                <Avatar
                  src={participant.avatarURL}
                  name={participant.name}
                  size={16}
                  className="rounded-full"
                />
              }
              hint={participant.isOwner ? 'Owner' : undefined}
            >
              <span className="truncate">
                {participant.name}
                {participant.id === currentUserId && <span className="text-tertiary"> (you)</span>}
              </span>
            </MenuItem>
          ))}
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          <MenuGroupLabel>Add a teammate</MenuGroupLabel>
          {!members && (
            <div className="flex items-center gap-2 px-2.5 py-1.5 text-[13px] text-tertiary">
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
              Loading members…
            </div>
          )}
          {members && invitable.length === 0 && (
            <div className="px-2.5 py-1.5 text-[13px] text-tertiary">
              Everyone in the team is already here.
            </div>
          )}
          {invitable.map((member) => (
            <MenuItem
              key={member.id}
              closeOnClick={false}
              disabled={inviting !== null}
              onClick={() => invite(member)}
              icon={
                inviting === member.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                ) : (
                  <Avatar
                    src={member.avatarURL}
                    name={member.name}
                    size={16}
                    className="rounded-full"
                  />
                )
              }
            >
              <span className="truncate">{member.name}</span>
            </MenuItem>
          ))}
        </MenuGroup>
        <MenuSeparator />
        <MenuItem
          closeOnClick={false}
          onClick={onCopyLink}
          icon={
            copied ? (
              <Check className="h-3.5 w-3.5 text-zViolet-accent" strokeWidth={2} />
            ) : (
              <Link2 className="h-3.5 w-3.5" strokeWidth={2} />
            )
          }
        >
          {copied ? 'Link copied' : 'Copy session link'}
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
