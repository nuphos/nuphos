import { t } from '../../i18n'
import { Avatar } from '../Avatar'

import { SidebarTeamSwitcher } from './header'

// Widths of the skeleton nav rows, grouped the way the real sidebar groups its
// sections, so the outline reads as the sidebar rather than a list of bars.
const SECTIONS = [
  ['56%', '72%', '48%'],
  ['64%', '44%', '68%', '52%'],
  ['60%', '40%'],
]

/**
 * A non-interactive outline of the sidebar for the "name your team" screens:
 * the real team switcher row carries the name as it is typed, so people see
 * where the name will live before they commit to it.
 */
export function SidebarNamePreview({ name }: { name: string }) {
  const label = name.trim() || t('Workspace')

  return (
    <div
      inert
      aria-hidden
      className="sidebar-surface flex h-[440px] w-[248px] select-none flex-col rounded-xl border border-line-control/70 pt-3 shadow-sm"
    >
      <SidebarTeamSwitcher
        loading={false}
        teamSegment={{
          label,
          icon: <Avatar name={label} size={20} className="rounded-[5px] !shadow-none" />,
        }}
      />
      <div className="space-y-5 px-[18px] pt-3">
        {SECTIONS.map((rows, section) => (
          <div key={section} className="space-y-3">
            {section > 0 && <div className="h-2 w-12 rounded bg-state-selected opacity-70" />}
            {rows.map((width, row) => (
              <div key={row} className="flex items-center gap-2.5">
                <div className="h-4 w-4 flex-shrink-0 rounded bg-state-selected" />
                <div className="h-2.5 rounded bg-state-selected" style={{ width }} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
