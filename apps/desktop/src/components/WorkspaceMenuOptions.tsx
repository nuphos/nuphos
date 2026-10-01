import { MenuGroup, MenuGroupLabel, MenuItem, MenuSeparator } from './ui/menu'

import type { BreadcrumbOption } from './Toolbar'
import type { ReactNode } from 'react'

// Renders grouped workspace-switcher rows with icons, labels and selection state.
export function renderWorkspaceMenuOptions(options: BreadcrumbOption[]): ReactNode {
  const groups = new Map<string | undefined, BreadcrumbOption[]>()

  for (const option of options) {
    const group = option.group

    if (!groups.has(group)) groups.set(group, [])
    groups.get(group)!.push(option)
  }

  const nodes: ReactNode[] = []
  let first = true

  for (const [group, items] of groups) {
    if (!first && group) {
      nodes.push(<MenuSeparator key={`sep-${group}`} />)
    }
    nodes.push(
      <MenuGroup key={`g-${group ?? 'default'}`}>
        {group && <MenuGroupLabel>{group}</MenuGroupLabel>}
        {items.map((option) => (
          <MenuItem
            key={option.key}
            selected={Boolean(option.selected)}
            onClick={() => option.onPick()}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              {option.icon && (
                <div className="flex flex-shrink-0 items-center [&>*]:!h-5 [&>*]:!w-5 [&>svg]:!h-5 [&>svg]:!w-5">
                  {option.icon}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate">{option.label}</div>
                {option.sublabel && (
                  <div className="truncate text-[11.5px] text-tertiary">{option.sublabel}</div>
                )}
              </div>
            </div>
          </MenuItem>
        ))}
      </MenuGroup>,
    )
    first = false
  }

  return nodes
}
