import clsx from 'clsx'
import { useRef, useState } from 'react'

import { renameOutcome } from './inlineRename'
import { toast } from './toast'

type Props = {
  value: string
  /** Shown while editing, and what an emptied name goes back to. Without one, empty cancels. */
  defaultName?: string
  /** Without it the name is plain text. */
  canEdit: boolean
  /** Controlled, so a ••• menu's Rename can start editing too. */
  editing: boolean
  onEditingChange: (editing: boolean) => void
  /** Resolves once saved; a rejection puts the old name back. */
  onSave: (label: string) => Promise<unknown>
  errorTitle: string
  ariaLabel: string
  maxLength?: number
  className?: string
}

/** A name that turns into a text field in place: Enter or blur saves, Escape cancels. */
export function InlineRename({
  value,
  canEdit,
  editing,
  onEditingChange,
  className,
  ...field
}: Props) {
  const [optimistic, setOptimistic] = useState<{ from: string; to: string } | null>(null)
  // Shown until the saved name arrives as `value`, or the save fails.
  const shown = optimistic?.from === value ? optimistic.to : value

  if (editing)
    return (
      <RenameField
        current={shown}
        defaultName={field.defaultName}
        ariaLabel={field.ariaLabel}
        maxLength={field.maxLength}
        className={className}
        onDone={(outcome) => {
          onEditingChange(false)
          if (!outcome?.save) return
          setOptimistic({ from: value, to: outcome.shown })
          field.onSave(outcome.label).catch((error: unknown) => {
            setOptimistic(null)
            toast.apiError(field.errorTitle, error)
          })
        }}
      />
    )

  return canEdit ? (
    <button
      type="button"
      title={`${shown} — click to rename`}
      onClick={() => onEditingChange(true)}
      className={clsx('min-w-0 truncate text-left hover:underline', className)}
    >
      {shown}
    </button>
  ) : (
    <span title={shown} className={clsx('min-w-0 truncate', className)}>
      {shown}
    </span>
  )
}

function RenameField({
  current,
  defaultName,
  ariaLabel,
  maxLength = 100,
  className,
  onDone,
}: Pick<Props, 'defaultName' | 'ariaLabel' | 'maxLength' | 'className'> & {
  current: string
  onDone: (outcome: ReturnType<typeof renameOutcome> | null) => void
}) {
  const [draft, setDraft] = useState(current)
  // Enter closes the field, and closing it blurs: settle once.
  const settled = useRef(false)
  const settle = (save: boolean) => {
    if (settled.current) return
    settled.current = true
    onDone(save ? renameOutcome(draft, current, defaultName) : null)
  }

  return (
    <input
      autoFocus
      aria-label={ariaLabel}
      value={draft}
      maxLength={maxLength}
      placeholder={defaultName}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => settle(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') settle(true)
        if (event.key === 'Escape') {
          event.stopPropagation()
          settle(false)
        }
      }}
      className={clsx(
        'h-7 min-w-0 flex-1 rounded-md border border-zGray-800 bg-field px-2 text-main outline-none focus:border-zViolet-500/70 placeholder:text-tertiary',
        className,
      )}
    />
  )
}
