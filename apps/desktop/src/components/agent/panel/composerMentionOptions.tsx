import { Laptop, MessageSquare } from 'lucide-react'

import { Avatar } from '../../Avatar'

import type { MentionOption } from './composerMentionChips'
import type { ReactNode } from 'react'

function Row({ icon, label, detail }: { icon: ReactNode; label: string; detail: string }) {
  return (
    <>
      {icon}
      <span className="truncate text-main">{label}</span>
      <span className="ml-auto truncate text-[11.5px] text-tertiary">{detail}</span>
    </>
  )
}

export function MentionOptionRow({ option }: { option: MentionOption }) {
  switch (option.kind) {
    case 'member':
      return (
        <Row
          icon={
            <Avatar
              src={option.member.avatarURL}
              name={option.member.name}
              size={18}
              className="rounded-full"
            />
          }
          label={option.member.name || option.member.email}
          detail={option.member.email}
        />
      )
    case 'device':
      return (
        <Row
          icon={<Laptop size={16} className="shrink-0 text-tertiary" />}
          label={option.device.label}
          detail="Device"
        />
      )
    case 'session':
      return (
        <Row
          icon={<MessageSquare size={16} className="shrink-0 text-tertiary" />}
          label={option.session.title || option.session.firstMessage || 'Untitled session'}
          detail="Session"
        />
      )
  }
}
