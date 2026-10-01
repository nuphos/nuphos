import { Check, ChevronRight, Minus } from 'lucide-react'

import { CloudLogo } from '../../CloudLogo'
import { MenuCheckboxItem, MenuContent, MenuSubmenu, MenuSubmenuTrigger } from '../../ui/menu'

import type { CredentialSection } from './credentialSections'

// Bare tri-state glyph matching MenuCheckboxItem's check indicator (no box):
// all → check, some → minus, none → empty.
export function TriBox({ state }: { state: 'all' | 'some' | 'none' }) {
  return (
    <span className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center text-main">
      {state === 'all' && <Check className="h-3.5 w-3.5" strokeWidth={2.4} />}
      {state === 'some' && <Minus className="h-3.5 w-3.5" strokeWidth={2.4} />}
    </span>
  )
}

// Cascade selector for one provider: each account/project is a row that opens a
// side submenu of its individual roles. A single-role account is a plain
// checkbox row (no submenu needed). Keeps the menu compact with many bindings.
const newBadge = (
  <span className="flex-shrink-0 rounded-full bg-zViolet-accent/15 px-1.5 py-px text-[10px] font-medium leading-tight text-zViolet-accent">
    New
  </span>
)

export function CredentialSectionGroup({
  sections,
  selectedIds,
  newIds,
  onChangeIds,
}: {
  sections: CredentialSection[]
  selectedIds: string[]
  newIds?: string[]
  onChangeIds: (ids: string[]) => void
}) {
  const selected = new Set(selectedIds)
  const fresh = new Set(newIds)

  // Hide providers with nothing bound so the menu stays short.
  if (sections.length === 0) return null

  return (
    <>
      {sections.map((section) => {
        const itemIds = section.items.map((i) => i.id)
        const selCount = itemIds.filter((id) => selected.has(id)).length
        const state: 'all' | 'some' | 'none' =
          selCount === 0 ? 'none' : selCount === itemIds.length ? 'all' : 'some'
        const toggleSection = () => {
          const next = new Set(selected)

          if (state === 'all') itemIds.forEach((id) => next.delete(id))
          else itemIds.forEach((id) => next.add(id))
          onChangeIds([...next])
        }

        // Single-role account: a plain checkbox row, no submenu.
        if (section.items.length === 1) {
          const item = section.items[0]

          return (
            <MenuCheckboxItem
              key={section.id}
              checked={selected.has(item.id)}
              onCheckedChange={() => onChangeIds(toggleId(selectedIds, item.id))}
            >
              <span className="flex min-w-0 items-center gap-2">
                <CloudLogo provider={section.provider} size={14} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-main">{section.title}</span>
                  <span className="block truncate text-[11px] text-tertiary">{item.label}</span>
                </span>
                {fresh.has(item.id) && newBadge}
              </span>
            </MenuCheckboxItem>
          )
        }

        return (
          <MenuSubmenu key={section.id}>
            <MenuSubmenuTrigger
              icon={<TriBox state={state} />}
              chevron={<ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />}
              title={
                state === 'all'
                  ? 'Click to deselect all; hover for individual roles'
                  : 'Click to select all; hover for individual roles'
              }
              // Clicking the parent toggles all roles under it; hovering still
              // opens the submenu for individual selection.
              onClick={(e) => {
                e.preventDefault()
                toggleSection()
              }}
            >
              <span className="flex min-w-0 items-center gap-2">
                <CloudLogo provider={section.provider} size={14} />
                <span className="min-w-0 flex-1 truncate">{section.title}</span>
                {itemIds.some((id) => fresh.has(id)) && newBadge}
                <span className="flex-shrink-0 text-[10.5px] text-tertiary tabular-nums">
                  {selCount}/{itemIds.length}
                </span>
              </span>
            </MenuSubmenuTrigger>
            <MenuContent side="inline-end" align="start" className="w-[260px]">
              {section.items.map((item) => (
                <MenuCheckboxItem
                  key={item.id}
                  checked={selected.has(item.id)}
                  onCheckedChange={() => onChangeIds(toggleId(selectedIds, item.id))}
                  className="items-start"
                >
                  <span className="min-w-0 block flex-1">
                    <span className="block truncate text-[12.5px] text-main">{item.label}</span>
                    <span className="block truncate text-[11.5px] text-tertiary">
                      {item.sublabel}
                    </span>
                  </span>
                  {fresh.has(item.id) && newBadge}
                </MenuCheckboxItem>
              ))}
            </MenuContent>
          </MenuSubmenu>
        )
      })}
    </>
  )
}

function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]
}
