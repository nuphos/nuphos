import clsx from 'clsx'
import { Loader2, RefreshCw } from 'lucide-react'

import { MenuGroup, MenuGroupLabel, MenuItem, MenuSeparator } from '../../ui/menu'

type FooterProps = {
  lines: string[]
  /** The line that reports a failure, announced as an alert. */
  error?: string
  onRetry?: () => void
  retrying: boolean
}

/** Connection notes under the effort controls, with a retry when it failed. */
export function ModelFooter({
  lines,
  error,
  onRetry,
  retrying,
  divided,
}: FooterProps & { divided: boolean }) {
  if (lines.length === 0) return null
  const Icon = retrying ? Loader2 : RefreshCw

  return (
    <div
      className={clsx(
        'mx-3 py-2 text-center text-xs text-tertiary',
        divided && 'border-t border-zGray-800/60',
      )}
    >
      {lines.map((line) => (
        <p key={line} role={line === error ? 'alert' : 'status'}>
          {line}
        </p>
      ))}
      {onRetry && (
        <button
          type="button"
          disabled={retrying}
          onClick={onRetry}
          className="mx-auto mt-1.5 flex items-center gap-1.5 rounded-md px-2 py-1 text-main outline-none hover:bg-zGray-800/80 focus-visible:bg-zGray-800/80 disabled:opacity-50"
        >
          <Icon size={13} className={clsx(retrying && 'animate-spin')} />
          Retry connection
        </button>
      )}
    </div>
  )
}

/** The same notes at the foot of the model menu, as a labelled menu group. */
export function ModelMenuFooter({ lines, onRetry, retrying }: FooterProps) {
  if (lines.length === 0) return null
  const Icon = retrying ? Loader2 : RefreshCw

  return (
    <>
      <MenuSeparator />
      <MenuGroup>
        <MenuGroupLabel className="max-w-64 text-xs font-normal normal-case tracking-normal">
          {lines.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </MenuGroupLabel>
        {onRetry && (
          <MenuItem
            icon={<Icon size={13} className={clsx(retrying && 'animate-spin')} />}
            disabled={retrying}
            closeOnClick={false}
            onClick={onRetry}
          >
            Retry connection
          </MenuItem>
        )}
      </MenuGroup>
    </>
  )
}
