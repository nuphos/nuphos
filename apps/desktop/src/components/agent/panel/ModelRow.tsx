import { useId } from 'react'

import { Kbd } from '../../ui/kbd'
import { MenuCheckboxItem } from '../../ui/menu'
import { Tooltip } from '../../ui/tooltip'

/**
 * One model in the model menu. Its description shows under the label when
 * `inline`, otherwise beside the row on hover; either way the row names it as
 * its description, so a screen reader hears it on reaching the row.
 */
export function ModelRow({
  label,
  description,
  inline,
  hint,
  checked,
  disabled,
  onSelect,
}: {
  label: string
  description?: string | null
  inline?: boolean
  /** A key that picks this row while the menu is open. */
  hint?: string
  checked: boolean
  disabled?: boolean
  onSelect: () => void
}) {
  const id = useId()
  const row = (
    <MenuCheckboxItem
      checked={checked}
      onCheckedChange={onSelect}
      disabled={disabled}
      describedBy={description ? id : undefined}
    >
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {hint && <Kbd combo={hint} />}
      </span>
      {description && (
        <span id={id} className={inline ? 'block text-xs text-tertiary' : 'sr-only'}>
          {description}
        </span>
      )}
    </MenuCheckboxItem>
  )

  return description && !inline ? (
    <Tooltip content={description} side="right" triggerClassName="grid">
      {row}
    </Tooltip>
  ) : (
    row
  )
}
