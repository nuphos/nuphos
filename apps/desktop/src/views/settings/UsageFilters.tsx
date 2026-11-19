import { ChevronRight, ListFilter, X } from 'lucide-react'

import { Button } from '../../components/ui/button'
import { Menu, MenuContent, MenuItem, MenuSubmenu, MenuTrigger } from '../../components/ui/menu'
import { MenuCheckboxItem, MenuSubmenuTrigger } from '../../components/ui/menu-extras'
import { t } from '../../i18n'
import { useTeamUsageQuery } from '../../lib/query/usage'

import {
  OTHERS_PRIVATE,
  TOKEN_USAGE_GROUPS,
  clearFilter,
  filterQuery,
  tokenUsageLines,
  toggleFilter,
  usageGroupLabel,
} from './tokenUsagePresentation'

import type { UsageFilters, UsageNames } from './tokenUsagePresentation'
import type { UsageDimension } from '../../types/usage'

/** The active filters as removable chips, and a menu to pick any dimension's values. */
export function UsageFilterBar({
  teamId,
  span,
  names,
  filters,
  onChange,
}: {
  teamId: string
  span: { from: string; to: string }
  names: UsageNames
  filters: UsageFilters
  onChange: (filters: UsageFilters) => void
}) {
  const active = Object.entries(filters).flatMap(([dimension, values]) =>
    values.length ? [{ dimension: dimension as UsageDimension, values }] : [],
  )

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
      {active.map(({ dimension, values }) => (
        <span
          key={dimension}
          className="flex min-w-0 items-center gap-1 rounded-md border border-line-control/70 py-0.5 pl-2 pr-1 text-main"
        >
          <span className="max-w-72 truncate">
            {usageGroupLabel(dimension)}: {values.map((value) => value.label).join(', ')}
          </span>
          <button
            type="button"
            aria-label={t('Clear filter')}
            onClick={() => onChange(clearFilter(filters, dimension))}
            className="rounded p-0.5 text-tertiary hover:bg-state-hover hover:text-main"
          >
            <X size={12} />
          </button>
        </span>
      ))}
      <Menu>
        <MenuTrigger
          render={
            <Button variant="secondary" size="sm">
              <ListFilter size={12} aria-hidden="true" />
              {t('Filter')}
            </Button>
          }
        />
        <MenuContent align="start" className="w-[200px]">
          {TOKEN_USAGE_GROUPS.map(({ value: dimension, label }) => (
            <MenuSubmenu key={dimension}>
              <MenuSubmenuTrigger chevron={<ChevronRight className="h-3 w-3" />}>
                {label}
              </MenuSubmenuTrigger>
              <MenuContent align="start" className="max-h-80 w-[240px] overflow-y-auto">
                <FilterChoices
                  teamId={teamId}
                  span={span}
                  dimension={dimension}
                  names={names}
                  filters={filters}
                  onChange={onChange}
                />
              </MenuContent>
            </MenuSubmenu>
          ))}
        </MenuContent>
      </Menu>
    </div>
  )
}

/** A dimension's values in the range, under the other filters, each one a checkbox. */
function FilterChoices({
  teamId,
  span,
  dimension,
  names,
  filters,
  onChange,
}: {
  teamId: string
  span: { from: string; to: string }
  dimension: UsageDimension
  names: UsageNames
  filters: UsageFilters
  onChange: (filters: UsageFilters) => void
}) {
  const { data } = useTeamUsageQuery(teamId, {
    ...span,
    ...filterQuery(filters, dimension),
    groupBy: dimension,
  })

  if (!data) return <MenuItem disabled>{t('Loading…')}</MenuItem>
  // The merged row of others' private conversations is not one thing to pick.
  const lines = tokenUsageLines(data.rows, dimension, { ...names, served: data.names }).filter(
    (line) => line.key && line.key !== OTHERS_PRIVATE,
  )

  if (lines.length === 0) return <MenuItem disabled>{t('No values')}</MenuItem>
  const picked = new Set((filters[dimension] ?? []).map((value) => value.value))

  return (
    <>
      {lines.map((line) => (
        <MenuCheckboxItem
          key={line.key}
          checked={picked.has(line.key)}
          onCheckedChange={() =>
            onChange(toggleFilter(filters, dimension, { value: line.key, label: line.label }))
          }
        >
          <span className="truncate">{line.label}</span>
        </MenuCheckboxItem>
      ))}
    </>
  )
}
