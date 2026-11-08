import { Search } from 'lucide-react'

import { t } from '../../i18n'
import { comboText } from '../../lib/platform'
import { SIDEBAR_PANEL_PADDING_CLASS, SidebarNavIcon, SidebarNavItem } from '../SidebarNavItem'

/** A sidebar row like the ones under it; ⌘K is the one shortcut shown at rest, as plain text. */
export function SidebarSearchButton({ onSearch }: { onSearch?: () => void }) {
  if (!onSearch) return null

  return (
    <div className={`titlebar-no-drag ${SIDEBAR_PANEL_PADDING_CLASS} !pb-1`}>
      <SidebarNavItem
        active={false}
        icon={<SidebarNavIcon icon={Search} />}
        label={t('Search')}
        onClick={onSearch}
        trailing={<span className="text-[12px] text-tertiary">{comboText('mod+k')}</span>}
      />
    </div>
  )
}
