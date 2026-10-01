import { faEye, faPen, faTrash } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'

import { Button } from '../../components/ui/button'
import { Switch } from '../../components/ui/Switch'

import type { Instruction } from '../../types/instructions'

export function InstructionCard({
  instruction,
  canEdit,
  busy,
  onToggle,
  onOpen,
  onDelete,
}: {
  instruction: Instruction
  canEdit: boolean
  busy: boolean
  onToggle: (enabled: boolean) => void
  onOpen: () => void
  onDelete: () => void
}) {
  return (
    <div
      className={clsx(
        'rounded-xl border border-zGray-800 p-4 transition-opacity',
        !instruction.enabled && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-medium text-main">{instruction.title}</p>
          <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-[12.5px] text-tertiary">
            {instruction.content}
          </p>
        </div>
        <Switch
          checked={instruction.enabled}
          disabled={!canEdit || busy}
          onChange={onToggle}
          label={`${instruction.enabled ? 'Disable' : 'Enable'} ${instruction.title}`}
        />
      </div>
      <div className="mt-3 flex items-center justify-end gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={onOpen}>
          <FontAwesomeIcon icon={canEdit ? faPen : faEye} className="mr-1.5 h-3 w-3" />
          {canEdit ? 'Edit' : 'View'}
        </Button>
        {canEdit && (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onDelete}>
            <FontAwesomeIcon icon={faTrash} className="mr-1.5 h-3 w-3" />
            Delete
          </Button>
        )}
      </div>
    </div>
  )
}
