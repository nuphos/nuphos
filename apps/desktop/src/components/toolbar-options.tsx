import { MenuGroup, MenuGroupLabel, MenuItem, MenuSeparator } from './ui/menu'

import type { BreadcrumbOption } from './toolbar-types'
import type { ReactNode } from 'react'

export function renderGroupedOptions(options: BreadcrumbOption[]): ReactNode {
  const groups = new Map<string | undefined, BreadcrumbOption[]>()

  for (const o of options) {
    const k = o.group

    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(o)
  }
  const out: ReactNode[] = []
  let first = true

  for (const [groupKey, items] of groups) {
    if (!first && groupKey) {
      out.push(<MenuSeparator key={`sep-${groupKey}`} />)
    }
    out.push(
      <MenuGroup key={`g-${groupKey ?? 'default'}`}>
        {groupKey && <MenuGroupLabel>{groupKey}</MenuGroupLabel>}
        {items.map((o) => (
          <MenuItem key={o.key} selected={!!o.selected} onClick={() => o.onPick()}>
            <div className="flex min-w-0 items-center gap-2">
              {o.icon && <div className="flex flex-shrink-0 items-center">{o.icon}</div>}
              <div className="min-w-0 flex-1">
                <div className="truncate">{o.label}</div>
                {o.sublabel && (
                  <div className="truncate text-[11px] text-tertiary">{o.sublabel}</div>
                )}
              </div>
            </div>
          </MenuItem>
        ))}
      </MenuGroup>,
    )
    first = false
  }

  return out
}
