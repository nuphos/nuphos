import { Search, SquarePen } from 'lucide-react'

import { t } from '../../i18n'
import { Avatar } from '../Avatar'

import { SidebarTeamSwitcher } from './header'

// Widths of the skeleton chat rows, so the list reads as chats rather than bars.
const CHATS = ['72%', '58%', '80%', '50%', '66%', '44%']

/**
 * A quiet, non-interactive picture of the Nuphos window for the "name your
 * team" screens: the real team switcher row carries the name as it is typed,
 * so people see where the name will live before they commit to it. It is laid
 * out wider than its column so the window runs off the edge like a glimpse of
 * the app.
 */
export function SidebarNamePreview({ name }: { name: string }) {
  const label = name.trim() || t('Workspace')

  return (
    <div
      inert
      aria-hidden
      className="sidebar-surface flex h-[480px] w-[720px] flex-shrink-0 select-none overflow-hidden rounded-xl border border-line-control/70 shadow-xl shadow-black/5"
    >
      <div className="flex w-[248px] flex-shrink-0 flex-col">
        <div className="flex h-[42px] items-center gap-2 px-4">
          {[0, 1, 2].map((dot) => (
            <span key={dot} className="h-3 w-3 rounded-full bg-state-selected" />
          ))}
        </div>
        <SidebarTeamSwitcher
          loading={false}
          teamSegment={{
            label,
            icon: <Avatar name={label} size={20} className="rounded-[5px] !shadow-none" />,
          }}
        />
        <div className="space-y-0.5 px-2.5 text-[13.5px] text-secondary">
          {[
            { icon: Search, text: t('Search') },
            { icon: SquarePen, text: t('New chat') },
          ].map(({ icon: Icon, text }) => (
            <div key={text} className="flex h-8 items-center gap-2.5 px-2">
              <Icon className="h-4 w-4 flex-shrink-0 text-tertiary" strokeWidth={1.8} />
              {text}
            </div>
          ))}
        </div>
        <div className="space-y-3.5 px-[18px] pt-5">
          <div className="h-2 w-14 rounded bg-state-selected opacity-70" />
          {CHATS.map((width) => (
            <div key={width} className="h-2.5 rounded bg-state-selected" style={{ width }} />
          ))}
        </div>
      </div>
      <div className="flex-1 py-2 pr-2">
        <div className="h-full space-y-4 rounded-lg border border-line-control/60 bg-main p-5">
          <div className="h-2.5 w-40 rounded bg-state-selected" />
          <div className="h-2.5 w-64 rounded bg-state-selected opacity-70" />
          <div className="h-2.5 w-52 rounded bg-state-selected opacity-70" />
        </div>
      </div>
    </div>
  )
}
