import clsx from 'clsx'

import { t } from '../../i18n'
import { comboText } from '../../lib/platform'

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
      <div className="px-4 pt-3 pb-1 text-[12.5px] text-tertiary">{t('Pages and actions')}</div>
      <div
        id={`${listId}-commands`}
        role="listbox"
        aria-label={t('Pages and actions')}
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
              'flex h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5',
              index === selectedIndex ? 'bg-state-selected' : 'hover:bg-state-hover',
            )}
          >
            <span className="flex size-6 shrink-0 items-center justify-center text-tertiary">
              <command.icon size={16} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[14px] text-main">
              <Highlight text={command.label} query={query} />
            </span>
            <span className="shrink-0 text-xs text-tertiary">
              {command.group === 'Go to' ? t('Go to') : t('Actions')}
            </span>
            {command.combo && (
              <span className="shrink-0 text-xs text-tertiary">{comboText(command.combo)}</span>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
