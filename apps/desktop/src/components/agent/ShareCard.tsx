import { Popover } from '@base-ui/react/popover'
import clsx from 'clsx'
import { Check, Copy, Link2, Loader2 } from 'lucide-react'
import { useState } from 'react'

import { useSuspendTitlebarDrag } from '../../hooks/useSuspendTitlebarDrag'
import { Avatar } from '../Avatar'
import { Button } from '../ui/button'

import { RoleMenu } from './ShareAccess'

import type {
  AgentConversationParticipant,
  GeneralAccess,
  ParticipantRole,
} from '../../api/agent-types'
import type { TeamMember } from '../../types'

// The pieces of the Share card in SessionParticipants (the picker lives in
// TeammatePicker). The card owns who is picked, who was just added, and what is busy.

/** "Ann", "Ann and Bo", "Ann, Bo, and 2 others". */
function joinNames(names: string[]) {
  if (names.length <= 2) return names.join(' and ')
  const others = names.length - 2

  return `${names[0]}, ${names[1]}, and ${String(others)} other${others === 1 ? '' : 's'}`
}

const AVATAR_SIZE = 22
// Reuse the ring the IAM avatar group uses, recoloured for the agent titlebar so
// overlapping avatars read as separate discs.
const AVATAR_CHROME = 'shrink-0 !rounded-full border-2 border-agentCanvas !shadow-none'
const VISIBLE_AVATARS = 3

export function AvatarStack({ participants }: { participants: AgentConversationParticipant[] }) {
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

/** Lives inside the portal, so the titlebar stops dragging exactly while the card is open. */
export function TitlebarDragSuspender() {
  useSuspendTitlebarDrag(true)

  return null
}

const SECTION_LABEL = 'px-1 text-[11px] font-medium text-tertiary'

const CHECK_BADGE =
  't-share-pop absolute flex h-4 w-4 items-center justify-center rounded-full border-2 border-main text-white'

export function CheckBadge({ className }: { className: string }) {
  return (
    <span className={clsx(CHECK_BADGE, className)}>
      <Check className="h-2.5 w-2.5" strokeWidth={3} />
    </span>
  )
}

/** The link with its Copy button, above who that link opens for. */
export function ShareLink({ url, children }: { url: string; children: React.ReactNode }) {
  const [copied, setCopied] = useState(false)
  const onCopy = () => {
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }

  return (
    <div className="flex flex-col rounded-lg border border-zGray-800/60">
      <div className="flex items-center gap-2 py-1 pl-2.5 pr-1">
        <Link2 className="h-3.5 w-3.5 shrink-0 text-tertiary" strokeWidth={2} />
        <span className="min-w-0 flex-1 truncate text-[12px] text-secondary">
          {url.replace(/^https?:\/\//, '')}
        </span>
        <button
          type="button"
          onClick={onCopy}
          className={clsx(
            'flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] font-medium transition-colors hover:bg-zGray-800/60',
            copied ? 'text-success' : 'text-secondary hover:text-main',
          )}
        >
          {copied ? (
            <Check key="copied" className="t-share-pop h-3 w-3" strokeWidth={2.5} />
          ) : (
            <Copy className="h-3 w-3" strokeWidth={2} />
          )}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="border-t border-zGray-800/60">{children}</div>
    </div>
  )
}

export function ParticipantList({
  participants,
  currentUserId,
  generalAccess,
  canManage,
  pending,
  onRoleChange,
  onRemove,
}: {
  participants: AgentConversationParticipant[]
  currentUserId: string
  generalAccess: GeneralAccess
  canManage: boolean
  pending: string | null
  onRoleChange: (participant: AgentConversationParticipant, role: ParticipantRole) => void
  onRemove: (participant: AgentConversationParticipant) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className={SECTION_LABEL}>In this session</div>
      {participants.map((participant) => {
        const role = participant.role === 'view' ? 'view' : 'reply'

        return (
          <div
            key={participant.id}
            className="flex h-7 items-center gap-2 rounded-md px-1 text-[13px] hover:bg-zGray-800/40"
          >
            <Avatar
              src={participant.avatarURL}
              name={participant.name}
              size={18}
              className={clsx('!rounded-full', participant.deactivated && 'opacity-50')}
            />
            <span className="min-w-0 flex-1 truncate text-main">
              {participant.name}
              {participant.id === currentUserId && <span className="text-tertiary"> (you)</span>}
            </span>
            {participant.isOwner && <span className="px-1.5 text-[12px] text-tertiary">Owner</span>}
            {!participant.isOwner && canManage && (
              <RoleMenu
                value={role}
                floor={generalAccess}
                disabled={pending !== null}
                onChange={(next) => onRoleChange(participant, next)}
                onRemove={() => onRemove(participant)}
              />
            )}
            {!participant.isOwner && !canManage && (
              <span className="px-1.5 text-[12px] text-tertiary">
                {role === 'view' && generalAccess !== 'reply' ? 'Can view' : 'Can reply'}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** What the card turns into once an invite lands: who was added, with Undo. */
export function AddedReceipt({
  added,
  detail,
  undoing,
  onUndo,
}: {
  added: TeamMember[]
  /** What they can now do, e.g. "They can view and reply". */
  detail: string
  undoing: boolean
  onUndo: () => void
}) {
  return (
    <div className="t-share-in flex flex-col items-center p-4 text-center">
      <span className="relative mb-3 flex -space-x-2">
        {added.slice(0, 3).map((member) => (
          <Avatar
            key={member.id}
            src={member.avatarURL}
            name={member.name}
            size={32}
            className="!rounded-full border-2 border-main"
          />
        ))}
        <CheckBadge className="-bottom-0.5 -right-1 bg-success" />
      </span>
      <div className="text-[13px] font-medium text-main">
        Added {joinNames(added.map((member) => member.name))}
      </div>
      <div className="mt-0.5 text-[12px] text-tertiary">{detail}</div>
      <div className="mt-4 grid w-full grid-cols-2 gap-2">
        <Button variant="secondary" size="sm" disabled={undoing} onClick={onUndo}>
          {undoing && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />}
          Undo
        </Button>
        <Popover.Close render={<Button variant="neutral" size="sm" />}>Done</Popover.Close>
      </div>
    </div>
  )
}
