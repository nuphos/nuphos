import { ArrowUp, PanelLeft, Plus, Search, SquarePen } from 'lucide-react'

import { t } from '../../i18n'
import { BotAvatarImage } from '../agent/BotAvatarImage'
import { Avatar } from '../Avatar'

import { SidebarTeamSwitcher } from './header'
import { SidebarFooter } from './SidebarFooter'
import { SidebarPageTabs } from './SidebarPageTabs'
import { SidebarSectionHeading } from './SidebarSectionHeading'
import './sidebar-pages.css'

import type { BotAvatarFile } from '../../lib/botAvatars'
import type { UserInfo } from '../../types'

// The bots a team starts with are not there yet, so their names stay blank.
const BOTS: [BotAvatarFile, string][] = [
  ['01-vermeer-girl.svg', '56%'],
  ['07-ada.svg', '40%'],
  ['03-mona-lisa.svg', '48%'],
]

const noop = () => {}

/**
 * A quiet, non-interactive piece of the Nuphos window for the "name your team"
 * screens, built from the real sidebar parts: the team switcher row carries
 * the name as it is typed, so people see where the name will live before they
 * commit to it. It runs off the right of its column like the app peeking in.
 */
export function SidebarNamePreview({ name, user }: { name: string; user: UserInfo }) {
  const label = name.trim() || t('Workspace')

  return (
    <div
      inert
      aria-hidden
      className="sidebar-surface flex h-[540px] w-[680px] flex-shrink-0 select-none rounded-l-xl border-y border-l border-line-control/60"
    >
      <div className="flex w-[248px] flex-shrink-0 flex-col border-r border-line-control/60">
        <div className="flex h-11 items-center gap-2 px-4">
          {['#ff5f57', '#febc2e', '#28c840'].map((color) => (
            <span key={color} className="h-3 w-3 rounded-full" style={{ background: color }} />
          ))}
          <div className="flex-1" />
          <PanelLeft className="h-4 w-4 text-tertiary" strokeWidth={1.8} />
          <Search className="h-4 w-4 text-tertiary" strokeWidth={1.8} />
        </div>
        <SidebarTeamSwitcher
          loading={false}
          teamSegment={{
            label,
            icon: <Avatar name={label} size={20} className="rounded-[5px] !shadow-none" />,
          }}
        />
        <div className="flex items-center px-2.5 pb-1">
          <SidebarSectionHeading
            section={{ title: 'Channels', items: [], nonCollapsible: true }}
            collapsed={false}
            toggle={noop}
          />
          <Plus className="mr-2 h-3.5 w-3.5 text-tertiary" strokeWidth={2} />
        </div>
        <div className="flex-1 space-y-0.5 px-2.5">
          {BOTS.map(([file, width]) => (
            <div key={file} className="flex h-9 items-center gap-2.5 px-2">
              <BotAvatarImage file={file} className="size-6 flex-shrink-0 object-contain" />
              <div className="h-2 rounded-full bg-state-selected" style={{ width }} />
            </div>
          ))}
        </div>
        <div className="sidebar-mode-switcher">
          <SidebarPageTabs page={0} onPage={noop} counts={[0, 0, 0]} />
        </div>
        <SidebarFooter connectorsOpen={false} onSelect={noop} user={user} onLogout={noop} />
      </div>
      {/* An empty chat: its title, then the composer waiting at the bottom. */}
      <div className="flex flex-1 flex-col bg-main">
        <div className="flex h-11 items-center gap-2 px-4 text-[13px] text-secondary">
          <SquarePen className="h-4 w-4 text-tertiary" strokeWidth={1.8} />
          {t('New chat')}
        </div>
        <div className="flex-1" />
        <div className="m-4 flex h-20 items-start justify-between rounded-2xl border border-line-control/70 p-4">
          <div className="mt-1 h-2 w-28 rounded-full bg-state-selected" />
          <span className="flex h-7 w-7 items-center justify-center self-end rounded-lg bg-state-selected text-tertiary">
            <ArrowUp className="h-4 w-4" strokeWidth={2.4} />
          </span>
        </div>
      </div>
    </div>
  )
}
