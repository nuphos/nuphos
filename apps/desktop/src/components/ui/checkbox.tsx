import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'
import clsx from 'clsx'
import { Check } from 'lucide-react'
import { forwardRef } from 'react'

import type { ComponentPropsWithoutRef } from 'react'

export type CheckboxProps = Omit<
  ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>,
  'className'
> & {
  className?: string
}

export const Checkbox = forwardRef<HTMLElement, CheckboxProps>(function Checkbox(
  { className, children, ...props },
  ref,
) {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={clsx(
        'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-zGray-700 bg-zGray-900 text-white outline-none transition-colors',
        'hover:border-zGray-600 focus-visible:ring-2 focus-visible:ring-zViolet-accent',
        'data-[checked]:border-[#fc6d26] data-[checked]:bg-[#fc6d26]',
        'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        {children ?? <Check className="h-3 w-3" strokeWidth={2.4} />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
})
