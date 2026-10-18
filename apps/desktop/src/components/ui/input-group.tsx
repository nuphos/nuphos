import { Input } from '@base-ui/react/input'
import { useRender } from '@base-ui/react/use-render'
import clsx from 'clsx'
import * as React from 'react'

// Text-entry controls have no global focus ring, so the decorated wrapper shows
// focus for the chrome-less control inside it, following its own border-radius.
export const inputGroupFocusClass = 'focus-within:ring-1 focus-within:ring-zViolet-500/60'
export const inputGroupControlClass = 'bg-transparent outline-none'
/**
 * A bordered form field: a secondary Button's surface and border, so inputs, selects and
 * buttons read as one family. Height comes from the caller: h-9 in forms, h-8 beside small buttons.
 */
export const fieldClass =
  'w-full rounded-md border border-main bg-surface px-2.5 text-[12.5px] text-main outline-none placeholder:text-tertiary focus:border-zViolet-500'

export function InputGroup({ render, className, ...props }: useRender.ComponentProps<'div'>) {
  return useRender({
    render,
    defaultTagName: 'div',
    props: { ...props, className: clsx(inputGroupFocusClass, className) },
  })
}

export const InputGroupInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.ComponentPropsWithoutRef<typeof Input>, 'className'> & { className?: string }
>(function InputGroupInput({ className, ...props }, ref) {
  return (
    <Input
      ref={ref}
      className={clsx('min-w-0 flex-1', inputGroupControlClass, className)}
      {...props}
    />
  )
})
