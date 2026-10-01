import { Radio } from '@base-ui/react/radio'
import clsx from 'clsx'

import type { WatchDestination } from '../../lib/monitoringWatch'
import type { ReactNode } from 'react'

export function WatchDestinationCard({
  value,
  selected,
  disabled,
  icon,
  title,
  description,
}: {
  value: WatchDestination['type']
  selected: boolean
  disabled?: boolean
  icon: ReactNode
  title: string
  description: string
}) {
  return (
    <Radio.Root
      value={value}
      disabled={disabled}
      className={clsx(
        'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
        selected
          ? 'border-zViolet-accent bg-zViolet-accent/10'
          : 'border-zGray-800 bg-zGray-900 hover:border-zGray-700 hover:bg-zGray-850',
        disabled && 'cursor-not-allowed opacity-45',
      )}
    >
      <span
        className={clsx(
          'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md',
          selected ? 'bg-zViolet-accent/15 text-zViolet-accent' : 'bg-zGray-800 text-secondary',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-medium text-main">{title}</span>
        <span className="mt-0.5 block text-[11.5px] text-tertiary">{description}</span>
      </span>
      <Radio.Indicator
        keepMounted
        className={clsx(
          'h-3.5 w-3.5 rounded-full border-2',
          selected ? 'border-[4px] border-zViolet-accent bg-white' : 'border-zGray-600',
        )}
      />
    </Radio.Root>
  )
}
