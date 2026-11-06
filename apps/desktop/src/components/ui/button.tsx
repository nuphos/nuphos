import { Button as BaseButton } from '@base-ui/react/button'
import clsx from 'clsx'
import { Children, forwardRef } from 'react'

import { capCenterClass } from './input-group'

export type ButtonVariant = 'primary' | 'neutral' | 'secondary' | 'ghost' | 'destructive'
export type ButtonSize = 'icon-sm' | 'sm' | 'md' | 'lg'

export type ButtonProps = Omit<BaseButton.Props, 'className'> & {
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
}

// Every button looks pressable and answers a press: pointer cursor, a short
// color transition and a slight scale-down while held.
const baseClasses =
  'inline-flex cursor-pointer items-center justify-center gap-2 font-medium whitespace-nowrap ' +
  'transition-[background-color,color,opacity,transform,box-shadow] duration-150 ease-out outline-none ' +
  'enabled:active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-line-focus focus-visible:ring-offset-1 ' +
  'focus-visible:ring-offset-surface-sheet ' +
  'disabled:cursor-not-allowed data-[disabled]:cursor-not-allowed'

const sizeClasses: Record<ButtonSize, string> = {
  'icon-sm': 'h-6 w-6 rounded-md p-0 text-[13px]',
  sm: 'h-8 rounded-lg px-2.5 text-[13px]',
  md: 'h-9 rounded-[10px] px-3 text-[14px]',
  lg: 'rounded-[10px] px-3.5 py-2.5 text-[16px]',
}

// Filled variants go quiet when disabled (the sunken surface) instead of fading,
// so a disabled primary never reads as a washed-out version of itself.
const FILLED_DISABLED =
  'disabled:bg-surface-sunken disabled:text-tertiary disabled:shadow-none ' +
  'data-[disabled]:bg-surface-sunken data-[disabled]:text-tertiary data-[disabled]:shadow-none'

const primary = `bg-action-primary text-inverse shadow-[0_1px_2px_rgba(0,0,0,0.12)] enabled:hover:opacity-90 ${FILLED_DISABLED}`

const variantClasses: Record<ButtonVariant, string> = {
  // The one primary action in a view: ink, not a brand color.
  primary,
  // Kept as a name for existing call sites; it is the same ink fill as primary.
  neutral: primary,
  // Paper: a raised surface with a hairline, for secondary actions.
  secondary:
    'bg-surface-raised text-primary shadow-[0_0_0_1px_rgb(var(--color-line-control)),0_1px_2px_rgba(0,0,0,0.04)] ' +
    'enabled:hover:bg-surface-sheet disabled:opacity-50 data-[disabled]:opacity-50',
  // Quiet: no fill until hovered, for escape hatches and toolbars.
  ghost:
    'text-secondary enabled:hover:bg-state-hover enabled:hover:text-primary ' +
    'disabled:opacity-50 data-[disabled]:opacity-50',
  destructive: `bg-status-danger text-inverse shadow-[0_1px_2px_rgba(0,0,0,0.12)] enabled:hover:opacity-90 ${FILLED_DISABLED}`,
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className, children, ...props },
  ref,
) {
  return (
    <BaseButton
      ref={ref}
      className={clsx(baseClasses, sizeClasses[size], variantClasses[variant], className)}
      {...props}
    >
      {/* A text label as its own block, so it can be trimmed to cap height and center like a field's. */}
      {Children.map(children, (child) =>
        typeof child === 'string' || typeof child === 'number' ? (
          <span className={capCenterClass}>{child}</span>
        ) : (
          child
        ),
      )}
    </BaseButton>
  )
})
