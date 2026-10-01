import clsx from 'clsx'

// `sensitive` marks a cell that can hold an env value. PostHog replay masks the
// text via the `[data-ph-mask]` selector, but it records element attributes
// verbatim — so the tooltip is dropped there rather than leaking the value in
// `title`.
export function readonlyText(
  value: string | null | undefined,
  options?: { mono?: boolean; muted?: boolean; sensitive?: boolean },
) {
  const text = value?.trim() || '-'

  return (
    <span
      className={clsx(
        'block min-w-0 truncate',
        options?.mono && 'font-mono text-[12px]',
        options?.muted ? 'text-tertiary' : 'text-main',
      )}
      title={options?.sensitive ? undefined : text}
      data-ph-mask={options?.sensitive ? '' : undefined}
    >
      {text}
    </span>
  )
}
