import clsx from 'clsx'

import { Button } from '../../components/ui/button'
import { Kbd } from '../../components/ui/kbd'
import { Tooltip } from '../../components/ui/tooltip'

export function ToolButton({
  active,
  label,
  hint,
  onClick,
  children,
}: {
  active?: boolean
  label: string
  hint?: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip
      content={
        <span className="inline-flex items-center gap-2">
          {label}
          {hint && <Kbd combo={hint} />}
        </span>
      }
    >
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        aria-pressed={active}
        className={clsx(
          'h-7 w-7',
          active && 'bg-action-primary text-inverse hover:bg-action-primary/90 hover:text-inverse',
        )}
        onClick={onClick}
      >
        {children}
      </Button>
    </Tooltip>
  )
}
