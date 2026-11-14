import { ArrowUp, Search, SquarePen } from 'lucide-react'

import { t } from '../../i18n'
import { Avatar } from '../Avatar'

import { SidebarTeamSwitcher } from './header'

// Widths of the skeleton chat titles, so the list reads as chats rather than bars.
const CHATS = ['64%', '48%', '72%', '40%', '56%']

/**
 * A quiet, non-interactive miniature of the Nuphos window for the "name your
 * team" screens: the real team switcher row carries the name as it is typed,
 * so people see where the name will live before they commit to it. Beside the
 * sidebar sits an empty chat, so the picture reads as the app.
 */
export function SidebarNamePreview({ name }: { name: string }) {
  const label = name.trim() || t('Workspace')

  return (
    <div
      inert
      aria-hidden
      className="sidebar-surface flex h-[420px] w-full max-w-[600px] select-none overflow-hidden rounded-xl border border-line-control/70 shadow-xl shadow-black/5"
    >
      <div className="flex w-[216px] flex-shrink-0 flex-col">
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
            <div key={width} className="flex items-center gap-2.5">
              <div className="h-4 w-4 flex-shrink-0 rounded-full bg-state-selected" />
              <div className="h-2.5 rounded bg-state-selected" style={{ width }} />
            </div>
          ))}
        </div>
      </div>
      {/* An empty chat: title bar, blank conversation, composer at the bottom. */}
      <div className="flex min-w-0 flex-1 py-2 pr-2">
        <div className="flex flex-1 flex-col rounded-lg border border-line-control/60 bg-main">
          <div className="flex h-10 items-center border-b border-line-control/60 px-4">
            <div className="h-2.5 w-24 rounded bg-state-selected" />
          </div>
          <div className="flex flex-1 items-center justify-center">
            <div className="h-2.5 w-32 rounded bg-state-selected opacity-70" />
          </div>
          <div className="m-3 flex h-[72px] flex-col justify-between rounded-xl border border-line-control/70 p-3">
            <div className="h-2.5 w-28 rounded bg-state-selected opacity-70" />
            <span className="flex h-6 w-6 items-center justify-center self-end rounded-md bg-state-selected text-tertiary">
              <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.4} />
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
