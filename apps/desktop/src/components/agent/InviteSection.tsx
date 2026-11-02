import { Loader2 } from 'lucide-react'

import { t } from '../../i18n'
import { Button } from '../ui/button'

import { RoleMenu } from './ShareAccess'
import { TeammatePicker } from './TeammatePicker'

import type { ParticipantRole } from '../../api/agent-types'
import type { Pickable } from './PersonFace'

function addLabel(count: number, chat: boolean) {
  if (count === 0) return chat ? t('Add to chat') : t('Add to agent')

  return count === 1 ? t('Add 1 person') : t('Add {n} people', { n: String(count) })
}

/** The picker, the role for those about to be added (when the viewer may set one), and the button that adds them. */
export function InviteSection({
  members,
  invitable,
  picked,
  onToggle,
  role,
  onRoleChange,
  chat,
  pending,
  onInvite,
}: {
  members: Pickable[] | null
  invitable: Pickable[]
  picked: Pickable[]
  onToggle: (member: Pickable) => void
  role: ParticipantRole | undefined
  onRoleChange: (role: ParticipantRole) => void
  chat: boolean
  pending: string | null
  onInvite: () => void
}) {
  return (
    <>
      <TeammatePicker
        members={members}
        invitable={invitable}
        picked={picked}
        disabled={pending !== null}
        onToggle={onToggle}
      />
      <div className="flex items-center gap-2">
        {role && <RoleMenu value={role} onChange={onRoleChange} />}
        <Button
          variant="neutral"
          size="sm"
          className="flex-1"
          disabled={picked.length === 0 || pending !== null}
          onClick={onInvite}
        >
          {pending === 'invite' && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />}
          {pending === 'invite' ? t('Adding…') : addLabel(picked.length, chat)}
        </Button>
      </div>
      {chat && (
        <div className="px-1 text-[12px] leading-snug text-tertiary">
          {t(
            'Adding your agent lets everyone here talk to it. Anything that needs approval still waits for you in its session.',
          )}
        </div>
      )}
    </>
  )
}
