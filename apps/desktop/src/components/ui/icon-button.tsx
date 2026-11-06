import { Button as BaseButton } from '@base-ui/react/button'
import clsx from 'clsx'
import { forwardRef } from 'react'

import { Kbd } from './kbd'
import { Tooltip } from './tooltip'

import type { ReactNode } from 'react'

export type IconButtonSize = 'sm' | 'md' | 'lg'

export type IconButtonProps = Omit<BaseButton.Props, 'className' | 'children'> & {
  /** What the button does. Becomes its accessible name and its tooltip. */
  label: string
  /** An existing shortcut for the same action, shown next to the label in the tooltip. */
  shortcut?: string
  icon: ReactNode
  size?: IconButtonSize
  className?: string
}

const sizeClasses: Record<IconButtonSize, string> = {
  sm: 'size-6 rounded-md [&_svg]:size-3.5',
  md: 'size-7 rounded-lg [&_svg]:size-4',
  lg: 'size-8 rounded-[10px] [&_svg]:size-[18px]',
}

/**
 * An icon-only action. It always has a label, shown as a tooltip on hover and
 * focus together with its shortcut, so icon buttons never need a separate hint.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, shortcut, icon, size = 'md', className, ...props },
  ref,
) {
  return (
    <Tooltip
      content={
        <span className="flex items-center gap-2">
          {label}
          {shortcut && <Kbd combo={shortcut} />}
        </span>
      }
      trigger={
        <BaseButton
          ref={ref}
          aria-label={label}
          className={clsx(
            'inline-flex shrink-0 cursor-pointer items-center justify-center text-tertiary outline-none',
            'transition-[background-color,color,transform] duration-150 ease-out',
            'enabled:hover:bg-state-hover enabled:hover:text-primary enabled:active:scale-[0.94]',
            'focus-visible:ring-2 focus-visible:ring-line-focus',
            'disabled:cursor-not-allowed disabled:opacity-40',
            sizeClasses[size],
            className,
          )}
          {...props}
        />
      }
    >
      {icon}
    </Tooltip>
  )
})
