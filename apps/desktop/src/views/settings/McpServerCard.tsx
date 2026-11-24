import { Pencil as PencilIcon, Trash2 as Trash2Icon } from 'lucide-react'

import { Button } from '../../components/ui/button'
import { UiIcon } from '../../components/ui/ui-icon'
import { t } from '../../i18n'

import type { TeamMcpServer } from '../../types/mcp-servers'

export function McpServerCard({
  server,
  busy,
  onEdit,
  onDelete,
}: {
  server: TeamMcpServer
  busy: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="rounded-xl border border-line-control p-4">
      <div className="min-w-0">
        <p className="truncate text-[13.5px] font-medium text-main">{server.name}</p>
        <p className="mt-0.5 truncate font-mono text-[12px] text-tertiary">{server.url}</p>
      </div>
      {server.headers.length > 0 && (
        <p className="mt-2 text-[12px] text-tertiary">
          {t('Headers: {names}', { names: server.headers.join(', ') })}
        </p>
      )}
      <div className="mt-3 flex items-center justify-end gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
          <UiIcon size={16} icon={PencilIcon} className="mr-1.5 h-4 w-4" />
          {t('Edit')}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onDelete}>
          <UiIcon size={16} icon={Trash2Icon} className="mr-1.5 h-4 w-4" />
          {t('Delete')}
        </Button>
      </div>
    </div>
  )
}
