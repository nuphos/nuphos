import { Popover } from '@base-ui/react/popover'
import clsx from 'clsx'
import { Check, Copy, Link2, Loader2, Users, X } from 'lucide-react'

import { Avatar } from '../Avatar'
import { Button } from '../ui/button'

import type { AgentConversationParticipant } from '../../api/agent-types'
import type { TeamMember } from '../../types'

// The pieces of the Share card in SessionParticipants (the picker lives in
// TeammatePicker). The card owns who is picked, who was just added, and what is busy.

/** "Ann", "Ann and Bo", "Ann, Bo, and 2 others". */
function joinNames(names: string[]) {
  if (names.length <= 2) return names.join(' and ')
  const others = names.length - 2

  return `${names[0]}, ${names[1]}, and ${String(others)} other${others === 1 ? '' : 's'}`
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

/** The link with its Copy button, and who that link opens for. */
export function ShareLink({
  url,
  copied,
  onCopy,
}: {
  url: string
  copied: boolean
  onCopy: () => void
}) {
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
      <div className="flex items-center gap-2 border-t border-zGray-800/60 px-2.5 py-1.5">
        <Users className="h-3.5 w-3.5 shrink-0 text-tertiary" strokeWidth={2} />
        <div className="min-w-0 leading-tight">
          <div className="text-[12px] text-main">Everyone in the team</div>
          <div className="text-[11px] text-tertiary">Can open and reply</div>
        </div>
      </div>
    </div>
  )
}

export function ParticipantList({
  participants,
  currentUserId,
  pending,
  onRemove,
}: {
  participants: AgentConversationParticipant[]
  currentUserId: string
  pending: string | null
  onRemove: (participant: AgentConversationParticipant) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className={SECTION_LABEL}>In this session</div>
      {participants.map((participant) => (
        <div
          key={participant.id}
          className="group flex h-7 items-center gap-2 rounded-md px-1 text-[13px] hover:bg-zGray-800/40"
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
          {participant.isOwner ? (
            <span className="text-[11px] text-tertiary">Owner</span>
          ) : (
            <button
              type="button"
              className="rounded p-0.5 text-tertiary opacity-0 hover:bg-zGray-700/60 hover:text-main focus-visible:opacity-100 disabled:opacity-50 group-hover:opacity-100"
              title={`Remove ${participant.name} from this session`}
              aria-label={`Remove ${participant.name} from this session`}
              disabled={pending !== null}
              onClick={() => onRemove(participant)}
            >
              {pending === participant.id ? (
                <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
              ) : (
                <X className="h-3 w-3" strokeWidth={2} />
              )}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

/** What the card turns into once an invite lands: who was added, with Undo. */
export function AddedReceipt({
  added,
  undoing,
  onUndo,
}: {
  added: TeamMember[]
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
      <div className="mt-0.5 text-[12px] text-tertiary">
        Everyone in the team can open and reply
      </div>
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
