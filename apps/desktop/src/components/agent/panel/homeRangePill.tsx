import { Button as BaseButton } from '@base-ui/react/button'
import clsx from 'clsx'

/** The home cards' range switch, e.g. 24h · 7d · 30d, as on the team activity card. */
export function RangePill<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div className={clsx('flex items-center gap-0.5 rounded-md bg-zGray-800/40 p-0.5', className)}>
      {options.map((r) => (
        <BaseButton
          key={r.value}
          aria-pressed={r.value === value}
          onClick={() => onChange(r.value)}
          className={clsx(
            'rounded px-2 py-0.5 text-[11px] outline-none transition-colors',
            r.value === value ? 'bg-zGray-700 text-main' : 'text-tertiary hover:text-main',
          )}
        >
          {r.label}
        </BaseButton>
      ))}
    </div>
  )
}
