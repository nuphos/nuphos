import clsx from 'clsx'
import { useId } from 'react'

import { ComposerPicker, ComposerPickerRow } from './composerPicker'

import type { SlashOption } from './composerSlashCommands'
import type { Popover } from '@base-ui/react/popover'

const SECTION_TITLES: Record<SlashOption['kind'], string> = {
  agent: 'Agent commands',
  nuphos: 'Nuphos actions',
}

function OptionRow({ option }: { option: SlashOption }) {
  if (option.kind === 'nuphos') {
    return (
      <>
        <span className="shrink-0 text-main">{option.action.title}</span>
        <span className="ml-auto truncate text-[11.5px] text-tertiary">
          {option.action.description}
        </span>
      </>
    )
  }
  const { name, description, hint } = option.command

  return (
    <>
      <span className="shrink-0 font-mono text-[12.5px] text-main">/{name}</span>
      {hint && <span className="shrink-0 text-[11.5px] text-tertiary">{hint}</span>}
      <span className="ml-auto truncate pl-2 text-[11.5px] text-tertiary" title={description}>
        {description}
      </span>
    </>
  )
}

/**
 * The `/` menu: the agent's own commands, then Nuphos actions, each under its
 * heading so an action never passes for something the agent runs.
 */
export function SlashCommandPicker({
  options,
  active,
  anchor,
  onSelect,
  onActive,
  onClose,
}: {
  options: SlashOption[]
  active: number
  anchor: Popover.Positioner.Props['anchor']
  onSelect: (option: SlashOption) => void
  onActive: (index: number) => void
  onClose: () => void
}) {
  const headingId = useId()
  // Each kind is contiguous; `index` stays the option's place in the whole list.
  const sections = (['agent', 'nuphos'] as const)
    .map((kind) => ({
      kind,
      rows: options.flatMap((option, index) => (option.kind === kind ? [{ option, index }] : [])),
    }))
    .filter((section) => section.rows.length > 0)

  return (
    <ComposerPicker
      open={options.length > 0}
      anchor={anchor}
      label="Commands"
      className="w-[340px]"
      onClose={onClose}
    >
      {sections.map(({ kind, rows }, sectionIndex) => (
        <div key={kind} role="group" aria-labelledby={`${headingId}-${kind}`}>
          <div
            id={`${headingId}-${kind}`}
            className={clsx(
              'px-2 pb-1 text-[11px] font-medium text-tertiary',
              sectionIndex === 0 ? 'pt-1.5' : 'pt-2',
            )}
          >
            {SECTION_TITLES[kind]}
          </div>
          {rows.map(({ option, index }) => (
            <ComposerPickerRow
              key={option.kind === 'agent' ? `agent:${option.command.name}` : option.action.id}
              selected={index === active}
              onSelect={() => onSelect(option)}
              onActive={() => onActive(index)}
            >
              <OptionRow option={option} />
            </ComposerPickerRow>
          ))}
        </div>
      ))}
    </ComposerPicker>
  )
}
