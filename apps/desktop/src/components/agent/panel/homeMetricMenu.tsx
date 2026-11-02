import { Ellipsis } from 'lucide-react'

import { t } from '../../../i18n'
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from '../../ui/menu'

import { SCOPES } from './homeMetricFormat'
import { ACTIVITY_RANGES } from './teamActivity'

import type { HomeMetricCard } from '../../../types/team.ts'

/** The card's ⋯ menu: its range, whose sessions it counts, and removing it. */
export function MetricCardMenu({
  card,
  showRange,
  showScope,
  onChange,
  onRemove,
}: {
  card: HomeMetricCard
  showRange: boolean
  showScope: boolean
  onChange: (card: HomeMetricCard) => void
  onRemove: () => void
}) {
  return (
    <Menu>
      <MenuTrigger
        aria-label={t('Card options')}
        className="rounded p-0.5 text-tertiary outline-none transition-colors hover:bg-zGray-800/60 hover:text-main"
      >
        <Ellipsis className="h-3.5 w-3.5" strokeWidth={1.8} />
      </MenuTrigger>
      <MenuContent align="end" className="w-[200px]">
        {showRange && (
          <MenuGroup>
            <MenuGroupLabel>{t('Range')}</MenuGroupLabel>
            <MenuRadioGroup
              value={card.range}
              onValueChange={(range) => onChange({ ...card, range })}
            >
              {ACTIVITY_RANGES.map((r) => (
                <MenuRadioItem key={r.value} value={r.value}>
                  {r.label}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuGroup>
        )}
        {showScope && (
          <>
            {showRange && <MenuSeparator />}
            <MenuGroup>
              <MenuGroupLabel>{t('Whose sessions')}</MenuGroupLabel>
              <MenuRadioGroup
                value={card.scope}
                onValueChange={(scope) => onChange({ ...card, scope })}
              >
                {SCOPES.map((s) => (
                  <MenuRadioItem key={s.value} value={s.value}>
                    {s.long}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
          </>
        )}
        {(showRange || showScope) && <MenuSeparator />}
        <MenuItem onClick={onRemove}>{t('Remove card')}</MenuItem>
      </MenuContent>
    </Menu>
  )
}
