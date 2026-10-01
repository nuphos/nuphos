import clsx from 'clsx'
import { ArrowLeft, Search } from 'lucide-react'
import { useState } from 'react'

import { DEFAULT_SIDEBAR_WIDTH } from '../../components/sidebar/state'
import {
  SIDEBAR_GROUP_GAP_CLASS,
  SIDEBAR_GROUP_ITEMS_CLASS,
  SIDEBAR_GROUP_TITLE_CLASS,
  SIDEBAR_PANEL_PADDING_CLASS,
  SIDEBAR_ROW_CLASS,
  SidebarNavIcon,
  SidebarNavItem,
} from '../../components/SidebarNavItem'
import { InputGroup, InputGroupInput } from '../../components/ui/input-group'

import { filterSettingsNavGroups } from './settingsNav'

import type { SettingsNavGroup } from './settingsNav'

export function SettingsNav({
  groups,
  section,
  onSelect,
  onBack,
}: {
  groups: SettingsNavGroup[]
  section: string
  onSelect: (key: string) => void
  onBack: () => void
}) {
  const [query, setQuery] = useState('')
  const visible = filterSettingsNavGroups(groups, query)
  const firstMatch = visible.at(0)?.items.at(0)

  return (
    <aside
      style={{ width: DEFAULT_SIDEBAR_WIDTH }}
      className={clsx(SIDEBAR_PANEL_PADDING_CLASS, 'flex flex-shrink-0 flex-col')}
    >
      <SidebarNavItem
        active={false}
        onClick={onBack}
        label="Back to app"
        icon={<SidebarNavIcon icon={ArrowLeft} />}
      />
      <InputGroup
        render={<label />}
        className={clsx(
          SIDEBAR_ROW_CLASS,
          'mb-3 mt-2 flex items-center bg-[var(--sidebar-overlay-hover)] text-tertiary',
        )}
      >
        <SidebarNavIcon icon={Search} />
        <InputGroupInput
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && firstMatch) onSelect(firstMatch.key)
            if (e.key === 'Escape' && query) {
              e.stopPropagation()
              setQuery('')
            }
          }}
          placeholder="Search"
          aria-label="Search settings"
          className="text-main placeholder:text-tertiary [&::-webkit-search-cancel-button]:hidden"
        />
      </InputGroup>
      <nav className="flex-1 overflow-y-auto scrollbar-thin">
        {visible.map((group) => (
          <div key={group.title} className={SIDEBAR_GROUP_GAP_CLASS}>
            <div className={SIDEBAR_GROUP_TITLE_CLASS}>{group.title}</div>
            <div className={SIDEBAR_GROUP_ITEMS_CLASS}>
              {group.items.map((item) => (
                <SidebarNavItem
                  key={item.key}
                  active={section === item.key}
                  onClick={() => onSelect(item.key)}
                  label={item.label}
                  icon={<SidebarNavIcon icon={item.icon} />}
                />
              ))}
            </div>
          </div>
        ))}
        {visible.length === 0 && (
          <div className={SIDEBAR_GROUP_TITLE_CLASS}>No matching settings</div>
        )}
      </nav>
    </aside>
  )
}
