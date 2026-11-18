import type { ReactNode } from 'react'

/** A key, or keys, and what pressing it does. */
export function KeyHint({ keys, label }: { keys: string[]; label: ReactNode }) {
  return (
    <span className="flex items-center gap-1">
      {keys.map((key) => (
        <kbd
          key={key}
          className="min-w-4 rounded bg-surface-sunken px-1 text-center font-sans text-[10.5px] leading-4 text-secondary"
        >
          {key}
        </kbd>
      ))}
      <span className="ml-0.5">{label}</span>
    </span>
  )
}
