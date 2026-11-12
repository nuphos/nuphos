import clsx from 'clsx'
import { Minus } from 'lucide-react'

import { Checkbox } from '../../components/ui/checkbox'
import { t } from '../../i18n'

import type { ReactNode } from 'react'

export type SkillPickerItem = {
  id: string
  title: string
  /** One line under the title: source, file count, description. */
  subtitle?: ReactNode
  /** A further line, e.g. where a linked skill resolves. */
  detail?: ReactNode
  /** Shown but not selectable, e.g. a skill that cannot be installed; Select all skips it. */
  disabled?: boolean
}

/**
 * A checkbox list of skills with Select all. Shared by every way of adding
 * skills in bulk (this computer, a GitHub repository), so they pick alike.
 */
export function SkillPicker({
  items,
  selected,
  onChange,
}: {
  items: readonly SkillPickerItem[]
  selected: ReadonlySet<string>
  onChange: (next: Set<string>) => void
}) {
  const selectable = items.filter((item) => !item.disabled)
  const count = selectable.filter((item) => selected.has(item.id)).length
  const all = count > 0 && count === selectable.length

  return (
    <div className="flex min-h-0 flex-col">
      <label className="flex h-8 items-center gap-2 border-b border-line-control/60 px-1 text-[12px] text-secondary">
        <Checkbox
          checked={all}
          indeterminate={count > 0 && !all}
          className="data-[indeterminate]:border-action-primary data-[indeterminate]:bg-action-primary"
          disabled={selectable.length === 0}
          onCheckedChange={() =>
            onChange(all ? new Set() : new Set(selectable.map((item) => item.id)))
          }
        >
          {count > 0 && !all ? <Minus className="h-3 w-3" strokeWidth={2.4} /> : undefined}
        </Checkbox>
        <span>{t('Select all')}</span>
        <span className="ml-auto text-tertiary">
          {t('{count} selected', { count: String(count) })}
        </span>
      </label>
      <ul className="min-h-0 flex-1 overflow-auto scrollbar-thin py-1">
        {items.map((item) => (
          <li key={item.id}>
            <label
              className={clsx(
                'flex items-start gap-2 rounded-md px-1 py-1.5',
                item.disabled
                  ? 'cursor-not-allowed opacity-60'
                  : 'cursor-pointer hover:bg-state-hover',
              )}
            >
              <Checkbox
                className="mt-0.5"
                disabled={item.disabled}
                checked={!item.disabled && selected.has(item.id)}
                onCheckedChange={(checked) => {
                  const next = new Set(selected)

                  if (checked) next.add(item.id)
                  else next.delete(item.id)
                  onChange(next)
                }}
              />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[12.5px] text-main">{item.title}</span>
                {item.subtitle && (
                  <span className="truncate text-[11px] text-tertiary">{item.subtitle}</span>
                )}
                {item.detail && (
                  <span className="break-all text-[11px] text-tertiary">{item.detail}</span>
                )}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  )
}
