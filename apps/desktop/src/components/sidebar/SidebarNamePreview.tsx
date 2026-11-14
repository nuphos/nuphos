import { ArrowUp, Bot, ListTodo, PanelLeft, Plug, Search, Settings, SquarePen } from 'lucide-react'

import { t } from '../../i18n'
import { Avatar } from '../Avatar'

import { SidebarTeamSwitcher } from './header'

import type { LucideIcon } from 'lucide-react'

const NAV: { icon: LucideIcon; label: string }[] = [
  { icon: SquarePen, label: t('New chat') },
  { icon: Plug, label: t('Connectors') },
  { icon: Settings, label: t('Settings') },
]

// The team's own bots and tasks don't exist yet, so those rows stay blank.
const SECTIONS: { icon: LucideIcon; label: string; rows: string[] }[] = [
  { icon: Bot, label: t('Bots'), rows: ['56%', '40%'] },
  { icon: ListTodo, label: t('Tasks'), rows: ['64%', '48%', '36%'] },
]

/**
 * A quiet, non-interactive piece of the Nuphos window for the "name your team"
 * screens: the real team switcher row carries the name as it is typed, so
 * people see where the name will live before they commit to it. It runs off
 * the right and bottom of its column like the app peeking in.
 */
export function SidebarNamePreview({ name }: { name: string }) {
  const label = name.trim() || t('Workspace')

  return (
    <div
      inert
      aria-hidden
      className="sidebar-surface flex h-[560px] w-[680px] flex-shrink-0 select-none rounded-tl-xl border-l border-t border-line-control/60"
      style={{ maskImage: 'linear-gradient(to bottom, black 70%, transparent)' }}
    >
      <div className="flex w-[248px] flex-shrink-0 flex-col border-r border-line-control/60">
        <div className="flex h-11 items-center justify-end gap-3 px-4 text-tertiary">
          <PanelLeft className="h-4 w-4" strokeWidth={1.8} />
          <Search className="h-4 w-4" strokeWidth={1.8} />
        </div>
        <SidebarTeamSwitcher
          loading={false}
          teamSegment={{
            label,
            icon: <Avatar name={label} size={20} className="rounded-[5px] !shadow-none" />,
          }}
        />
        <div className="space-y-0.5 px-2.5 text-[13.5px] text-secondary">
          {NAV.map(({ icon: Icon, label: text }) => (
            <div key={text} className="flex h-8 items-center gap-2.5 px-2">
              <Icon className="h-4 w-4 flex-shrink-0 text-tertiary" strokeWidth={1.8} />
              {text}
            </div>
          ))}
        </div>
        {SECTIONS.map(({ icon: Icon, label: heading, rows }) => (
          <div key={heading} className="px-2.5 pt-4">
            <div className="px-2 pb-1 text-[12px] font-medium text-tertiary">{heading}</div>
            {rows.map((width) => (
              <div key={width} className="flex h-8 items-center gap-2.5 px-2">
                <Icon
                  className="h-4 w-4 flex-shrink-0 text-tertiary opacity-60"
                  strokeWidth={1.8}
                />
                <div className="h-2 rounded-full bg-state-selected" style={{ width }} />
              </div>
            ))}
          </div>
        ))}
      </div>
      {/* An empty chat: its title, then the composer waiting at the bottom. */}
      <div className="flex flex-1 flex-col bg-main">
        <div className="flex h-11 items-center gap-2 px-4 text-[13.5px] text-secondary">
          <SquarePen className="h-4 w-4 text-tertiary" strokeWidth={1.8} />
          {t('New chat')}
        </div>
        <div className="flex-1" />
        <div className="mx-4 mb-24 flex h-20 items-start justify-between rounded-2xl border border-line-control/70 p-4">
          <div className="mt-1 h-2 w-28 rounded-full bg-state-selected" />
          <span className="flex h-7 w-7 items-center justify-center self-end rounded-lg bg-state-selected text-tertiary">
            <ArrowUp className="h-4 w-4" strokeWidth={2.4} />
          </span>
        </div>
      </div>
    </div>
  )
}
