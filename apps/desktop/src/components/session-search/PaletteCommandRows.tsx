import clsx from 'clsx'

import { Kbd } from '../ui/kbd'

import { Highlight } from './SearchResultRow'

import type { PaletteCommand } from './paletteCommands'

/** Pages and actions matching the ⌘K query, listed above the session results. */
export function PaletteCommandRows({
  listId,
  commands,
  query,
  selectedIndex,
  onSelect,
  onRun,
}: {
  listId: string
  commands: PaletteCommand[]
  query: string
  selectedIndex: number
  onSelect: (index: number) => void
  onRun: (command: PaletteCommand) => void
}) {
  return (
    <>
      <div className="flex h-8 items-center px-4 text-xs font-medium text-secondary">
        Pages and actions
      </div>
      <div
        id={`${listId}-commands`}
        role="listbox"
        aria-label="Pages and actions"
        className="px-2 pb-2"
      >
        {commands.map((command, index) => (
          <div
            key={command.id}
            id={`${listId}-${String(index)}`}
            role="option"
            aria-selected={index === selectedIndex}
            onMouseMove={() => onSelect(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onRun(command)}
            className={clsx(
              'flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2',
              index === selectedIndex ? 'bg-zGray-750' : 'hover:bg-zGray-800',
            )}
          >
            <command.icon size={16} className="shrink-0 text-secondary" />
            <span className="min-w-0 flex-1 truncate text-[13px] text-main">
              <Highlight text={command.label} query={query} />
            </span>
            <span className="shrink-0 text-xs text-secondary">{command.group}</span>
            {command.combo && <Kbd combo={command.combo} />}
          </div>
        ))}
      </div>
    </>
  )
}
