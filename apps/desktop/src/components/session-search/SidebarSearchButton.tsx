import { Search } from 'lucide-react'

import { t } from '../../i18n'
import { Kbd } from '../ui/kbd'
import { Tooltip } from '../ui/tooltip'

import { noteSearchSource } from './searchSource'

/** ⌘K's button in the titlebar, beside the sidebar toggle and styled like it. */
export function SidebarSearchButton({ onSearch }: { onSearch: () => void }) {
  return (
    <Tooltip
      content={
        <span className="inline-flex items-center gap-1.5">
          {t('Search')} <Kbd combo="mod+k" />
        </span>
      }
    >
      <button
        type="button"
        onClick={() => {
          noteSearchSource('button')
          onSearch()
        }}
        className="titlebar-no-drag w-8 h-8 rounded-md flex items-center justify-center text-tertiary transition-colors hover:text-secondary hover:bg-[var(--sidebar-overlay-hover)]"
        aria-label={t('Search')}
        data-search-trigger
      >
        <Search className="w-[15px] h-[15px]" strokeWidth={1.5} />
      </button>
    </Tooltip>
  )
}
