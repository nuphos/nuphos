import { Button as BaseButton } from '@base-ui/react/button'
import clsx from 'clsx'
import { forwardRef } from 'react'

export type ButtonVariant = 'primary' | 'neutral' | 'secondary' | 'ghost' | 'destructive'
export type ButtonSize = 'icon-sm' | 'sm' | 'md' | 'lg'

export type ButtonProps = Omit<BaseButton.Props, 'className'> & {
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
}

const baseClasses =
  'inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap ' +
  'transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-0 ' +
  'disabled:cursor-not-allowed disabled:opacity-50 ' +
  'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50'

const sizeClasses: Record<ButtonSize, string> = {
  'icon-sm': 'h-6 w-6 p-0 text-[13px]',
  sm: 'h-8 px-2.5 text-[13px]',
  md: 'px-[10px] py-[8px] text-[14px]',
  lg: 'px-[12px] py-[10px] text-[16px]',
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-zViolet-500 text-white shadow-[inset_0_0_0_1px_rgba(0,0,0,0.15)] ' +
    'hover:bg-zViolet-400 active:bg-zViolet-600 focus-visible:ring-zViolet-accent',
  neutral:
    'bg-[rgb(var(--color-text-base))] text-[rgb(var(--color-background-base))] hover:opacity-90 focus-visible:ring-zViolet-accent',
  secondary:
    'border border-main bg-surface text-main hover:bg-zGray-800 ' +
    'focus-visible:ring-zViolet-accent',
  ghost: 'text-secondary hover:bg-zGray-800 hover:text-main focus-visible:ring-zViolet-accent',
  destructive:
    'bg-error text-white shadow-[inset_0_0_0_1px_rgba(0,0,0,0.15)] ' +
    'hover:bg-error/85 active:bg-error/75 focus-visible:ring-error',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className, ...props },
  ref,
) {
  return (
    <BaseButton
      ref={ref}
      className={clsx(baseClasses, sizeClasses[size], variantClasses[variant], className)}
      {...props}
    />
  )
})
