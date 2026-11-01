import clsx from 'clsx'

/** The accent line in the gap a dragged Pinned row will land in. */
export function DropLine({ edge }: { edge: 'top' | 'bottom' }) {
  return (
    <div
      aria-hidden="true"
      className={clsx(
        'pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-zViolet-500',
        edge === 'top' ? '-top-px' : 'bottom-0',
      )}
    />
  )
}
