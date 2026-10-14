import { Popover } from '@base-ui/react/popover'
import clsx from 'clsx'
import { Laptop, MessageSquare } from 'lucide-react'

import { Avatar } from '../../Avatar'

import { deviceDetail } from './composerMention'
import { optionKey } from './composerMentionChips'

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

const SECTION_TITLES: Record<MentionOption['kind'], string> = {
  member: 'People',
  device: 'Devices',
  session: 'Chats',
}

function MentionOptionRow({
  option,
  devices,
}: {
  option: MentionOption
  devices: Extract<MentionOption, { kind: 'device' }>['device'][]
}) {
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
          detail={deviceDetail(option.device, devices)}
        />
      )
    case 'session':
      return (
        <Row
          icon={<MessageSquare size={16} className="shrink-0 text-tertiary" />}
          label={option.session.title || option.session.firstMessage || 'Untitled session'}
          detail=""
        />
      )
  }
}

/** Uses the same Base UI anchor positioning as the composer's menus. */
export function MentionPicker({
  options,
  active,
  anchor,
  onSelect,
  onActive,
  onClose,
}: {
  options: MentionOption[]
  active: number
  anchor: Popover.Positioner.Props['anchor']
  onSelect: (option: MentionOption) => void
  onActive: (index: number) => void
  onClose: () => void
}) {
  const devices = options.flatMap((option) => (option.kind === 'device' ? [option.device] : []))

  return (
    <Popover.Root
      open={options.length > 0}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <Popover.Portal>
        <Popover.Positioner
          anchor={anchor}
          side="top"
          align="start"
          sideOffset={6}
          className="z-[1000]"
        >
          <Popover.Popup
            role="listbox"
            initialFocus={false}
            finalFocus={false}
            style={{ transformOrigin: 'var(--transform-origin)' }}
            className="t-dropdown is-open w-[280px] max-h-[var(--available-height)] overflow-auto rounded-lg border border-zGray-800/60 bg-main p-1 shadow-[0_10px_28px_-6px_rgba(0,0,0,0.6)] outline-none"
          >
            {options.map((option, index) => [
              option.kind !== options[index - 1]?.kind && (
                <div
                  key={`heading-${option.kind}`}
                  role="presentation"
                  className="px-2 pb-1 pt-2 text-[11px] font-medium text-tertiary first:pt-1"
                >
                  {SECTION_TITLES[option.kind]}
                </div>
              ),
              <div
                key={optionKey(option)}
                role="option"
                aria-selected={index === active}
                className={clsx(
                  'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px]',
                  index === active && 'bg-zGray-800/60',
                )}
                // Keep focus (and the caret) in the editor.
                onMouseDown={(e) => {
                  e.preventDefault()
                  onSelect(option)
                }}
                onMouseEnter={() => onActive(index)}
              >
                <MentionOptionRow option={option} devices={devices} />
              </div>,
            ])}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
