import { Search } from 'lucide-react'

import { t } from '../../i18n'
import { Kbd } from '../ui/kbd'

export function SidebarSearchButton({ onSearch }: { onSearch?: () => void }) {
  if (!onSearch) return null

  return (
    <button
      onClick={onSearch}
      className="titlebar-no-drag mx-2.5 mb-1 flex items-center gap-2.5 rounded-md px-2 py-2 text-[13px] text-secondary hover:bg-zGray-800/60 hover:text-main"
    >
      <Search size={16} />
      <span className="flex-1 text-left">{t('Search')}</span>
      <Kbd combo="mod+k" />
    </button>
  )
}
