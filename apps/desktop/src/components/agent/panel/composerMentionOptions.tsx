import clsx from 'clsx'
import { Laptop } from 'lucide-react'
import { useId } from 'react'

import { t } from '../../../i18n'
import { Avatar } from '../../Avatar'
import { AgentAvatar } from '../AgentAvatar'

import { deviceDetail } from './composerMention'
import { optionKey } from './composerMentionChips'
import { ComposerPicker, ComposerPickerRow } from './composerPicker'

import type { MentionOption } from './composerMentionChips'
import type { Popover } from '@base-ui/react/popover'
import type { ReactNode } from 'react'

function Row({ icon, label, detail }: { icon: ReactNode; label: string; detail?: string }) {
  return (
    <>
      {icon}
      <span className="truncate text-main">{label}</span>
      {detail && <span className="ml-auto truncate text-[11.5px] text-tertiary">{detail}</span>}
    </>
  )
}

const SECTION_TITLES: Record<MentionOption['kind'], string> = {
  member: t('People'),
  device: t('Computers'),
  session: t('Agents'),
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
          icon={
            <AgentAvatar
              agentId={option.session.sessionId}
              avatar={option.session.avatar}
              provider={option.session.agentRuntime}
              size={18}
            />
          }
          label={option.session.title || option.session.firstMessage || t('Untitled agent')}
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
  allDevices,
}: {
  options: MentionOption[]
  /** Every device, not just the matches shown, so a repeated name is caught. */
  allDevices: Extract<MentionOption, { kind: 'device' }>['device'][]
  active: number
  anchor: Popover.Positioner.Props['anchor']
  onSelect: (option: MentionOption) => void
  onActive: (index: number) => void
  onClose: () => void
}) {
  const headingId = useId()
  // Each kind is contiguous; `index` stays the option's place in the whole list.
  const sections = (['member', 'device', 'session'] as const)
    .map((kind) => ({
      kind,
      rows: options.flatMap((option, index) => (option.kind === kind ? [{ option, index }] : [])),
    }))
    .filter((section) => section.rows.length > 0)

  return (
    <ComposerPicker
      open={options.length > 0}
      anchor={anchor}
      className="w-[280px]"
      onClose={onClose}
    >
      {sections.map(({ kind, rows }, sectionIndex) => (
        <div key={kind} role="group" aria-labelledby={`${headingId}-${kind}`}>
          <div
            id={`${headingId}-${kind}`}
            className={clsx(
              'px-2 pb-1 text-[11px] font-medium text-tertiary',
              sectionIndex === 0 ? 'pt-1' : 'pt-2',
            )}
          >
            {SECTION_TITLES[kind]}
          </div>
          {rows.map(({ option, index }) => (
            <ComposerPickerRow
              key={optionKey(option)}
              selected={index === active}
              onSelect={() => onSelect(option)}
              onActive={() => onActive(index)}
            >
              <MentionOptionRow option={option} devices={allDevices} />
            </ComposerPickerRow>
          ))}
        </div>
      ))}
    </ComposerPicker>
  )
}
