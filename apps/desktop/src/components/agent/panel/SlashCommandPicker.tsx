import { ComposerPicker, ComposerPickerRow } from './composerPicker'

import type { SlashCommand } from './composerSlashCommands'
import type { Popover } from '@base-ui/react/popover'

/** The `/` menu: Nuphos actions, labelled as such so they don't pass for agent commands. */
export function SlashCommandPicker({
  commands,
  active,
  anchor,
  onSelect,
  onActive,
  onClose,
}: {
  commands: SlashCommand[]
  active: number
  anchor: Popover.Positioner.Props['anchor']
  onSelect: (command: SlashCommand) => void
  onActive: (index: number) => void
  onClose: () => void
}) {
  return (
    <ComposerPicker
      open={commands.length > 0}
      anchor={anchor}
      label="Nuphos actions"
      className="w-[300px]"
      onClose={onClose}
    >
      <div role="presentation" className="px-2 pb-1 pt-1.5 text-[11px] font-medium text-tertiary">
        Nuphos actions
      </div>
      {commands.map((command, index) => (
        <ComposerPickerRow
          key={command.id}
          selected={index === active}
          onSelect={() => onSelect(command)}
          onActive={() => onActive(index)}
        >
          <span className="shrink-0 text-main">{command.title}</span>
          <span className="ml-auto truncate text-[11.5px] text-tertiary">
            {command.description}
          </span>
        </ComposerPickerRow>
      ))}
    </ComposerPicker>
  )
}
