import clsx from 'clsx'

export function ModalScrollFade({ isLight }: { isLight: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={clsx(
        'pointer-events-none absolute inset-x-0 top-full h-5 bg-gradient-to-b to-transparent',
        isLight ? 'from-white' : 'from-surface-sheet',
      )}
    />
  )
}
