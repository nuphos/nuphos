import clsx from 'clsx'
import { Eye as EyeIcon, Pencil as PencilIcon, Trash2 as Trash2Icon } from 'lucide-react'

import { Button } from '../../components/ui/button'
import { Switch } from '../../components/ui/Switch'
import { UiIcon } from '../../components/ui/ui-icon'
import { t } from '../../i18n'

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
        'rounded-xl border border-line-control p-4 transition-opacity',
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
          label={
            instruction.enabled
              ? t('Disable {title}', { title: instruction.title })
              : t('Enable {title}', { title: instruction.title })
          }
        />
      </div>
      <div className="mt-3 flex items-center justify-end gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={onOpen}>
          <UiIcon size={16} icon={canEdit ? PencilIcon : EyeIcon} className="mr-1.5 h-4 w-4" />
          {canEdit ? t('Edit') : t('View')}
        </Button>
        {canEdit && (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onDelete}>
            <UiIcon size={16} icon={Trash2Icon} className="mr-1.5 h-4 w-4" />
            {t('Delete')}
          </Button>
        )}
      </div>
    </div>
  )
}
