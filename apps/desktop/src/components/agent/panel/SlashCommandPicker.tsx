import { Popover } from '@base-ui/react/popover'
import clsx from 'clsx'

import type { SlashCommand } from './composerSlashCommands'

/** The `/` menu; same anchor positioning and look as the @ mention picker. */
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
    <Popover.Root
      open={commands.length > 0}
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
            aria-label="Slash commands"
            initialFocus={false}
            finalFocus={false}
            style={{ transformOrigin: 'var(--transform-origin)' }}
            className="t-dropdown is-open w-[300px] max-h-[var(--available-height)] overflow-auto rounded-lg border border-zGray-800/60 bg-main p-1 shadow-[0_10px_28px_-6px_rgba(0,0,0,0.6)] outline-none"
          >
            {commands.map((command, index) => (
              <div
                key={command.id}
                role="option"
                aria-selected={index === active}
                className={clsx(
                  'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px]',
                  index === active && 'bg-zGray-800/60',
                )}
                // Keep focus (and the caret) in the editor.
                onMouseDown={(e) => {
                  e.preventDefault()
                  onSelect(command)
                }}
                onMouseEnter={() => onActive(index)}
              >
                <span className="shrink-0 text-main">{command.title}</span>
                <span className="ml-auto truncate text-[11.5px] text-tertiary">
                  {command.description}
                </span>
              </div>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
