import { ChevronRight, Gauge } from 'lucide-react'

import { t } from '../../../i18n'
import { MenuContent, MenuItem, MenuSubmenu, MenuSubmenuTrigger } from '../../ui/menu'

import { METRIC_CARDS } from './homeMetricCards'

import type { HomeMetricKind } from '../../../types/team.ts'

const chevron = <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />

/** "Metrics" in Customize: every kind of metric card, each click adding one. */
export function MetricsSubmenu({ onAdd }: { onAdd: (kind: HomeMetricKind) => void }) {
  return (
    <MenuSubmenu>
      <MenuSubmenuTrigger
        icon={<Gauge className="h-3.5 w-3.5" strokeWidth={1.8} />}
        chevron={chevron}
      >
        <span className="flex-1">{t('Metrics')}</span>
      </MenuSubmenuTrigger>
      <MenuContent side="inline-end" align="start" className="w-[232px]">
        {METRIC_CARDS.map((card) => {
          const Icon = card.icon

          return (
            <MenuItem
              key={card.kind}
              icon={<Icon className="h-3.5 w-3.5" strokeWidth={1.8} />}
              onClick={() => onAdd(card.kind)}
            >
              {card.title}
            </MenuItem>
          )
        })}
      </MenuContent>
    </MenuSubmenu>
  )
}
