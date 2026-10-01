import clsx from 'clsx'

// Shared toggle switch. Desktop previously hand-rolled this at every call site
// (Sidebar, Table, Triggers, Lark groups, …), which is how the Lark one ended
// up visually broken. One styled control, reused. Kept hand-rolled (not Base UI
// yet) to match the existing call sites; safe to swap for Base UI Switch later.
export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  /** aria-label — required when there's no visible text label next to the switch. */
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-zViolet-500' : 'bg-zGray-700',
      )}
    >
      <span
        className={clsx(
          'inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}
