import { createPortal } from 'react-dom'

import { useToolbarSlot } from '../../hooks/useToolbarControls'

import { FilterTabs } from './triggerFilters'
import { PAGE_VIEWS } from './useTriggersPageView'

import type { TriggersPageView } from './useTriggersPageView'

export function PageViewSwitch({
  active,
  value,
  onChange,
}: {
  /** Gate on the active workspace tab showing the list or calendar. */
  active: boolean
  value: TriggersPageView
  onChange: (next: TriggersPageView) => void
}) {
  const slot = useToolbarSlot('right', active)

  return (
    slot && createPortal(<FilterTabs tabs={PAGE_VIEWS} value={value} onChange={onChange} />, slot)
  )
}
