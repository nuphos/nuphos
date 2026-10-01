import { Pencil, Play, Trash2 } from 'lucide-react'

import type { TriggerListRow } from './triggerRows'
import type { ContextMenuItem } from '../../components/ContextMenu'

/**
 * The row's own actions. Not columns: these act on the row rather than describe
 * it, and a table that renders them inline has no room left for the facts.
 */
export function buildTriggerRowMenu(
  row: TriggerListRow,
  ctx: {
    canManage: boolean
    canDelete: boolean
    /** A fire is already in flight; a second one would double the run. */
    firing: boolean
    onOpenGroup: (groupId: string, name: string) => void
    onEditTrigger: (triggerId: string, name: string) => void
    onRunNow: (row: TriggerListRow) => void
    onDelete: (row: TriggerListRow) => void
  },
): ContextMenuItem[] {
  const remove: ContextMenuItem = {
    key: 'delete',
    label: row.kind === 'group' ? 'Delete group' : 'Delete trigger',
    icon: Trash2,
    destructive: true,
    // Deleting tears down provider resources, so it follows the same
    // administrator-only rule the settings pages enforce.
    disabled: !ctx.canDelete,
    onSelect: () => ctx.onDelete(row),
  }

  if (row.kind === 'group') {
    return [
      {
        key: 'manage',
        label: ctx.canManage ? 'Manage group' : 'View group',
        icon: Pencil,
        onSelect: () => ctx.onOpenGroup(row.group.id, row.group.name),
      },
      { key: 'sep', separator: true },
      remove,
    ]
  }

  return [
    {
      key: 'edit',
      label: ctx.canManage ? 'Edit settings' : 'View settings',
      icon: Pencil,
      onSelect: () => ctx.onEditTrigger(row.trigger.id, row.trigger.name),
    },
    {
      key: 'test-fire',
      label: 'Run now',
      icon: Play,
      disabled: !ctx.canManage || ctx.firing || Boolean(row.trigger.cleanupStatus),
      onSelect: () => ctx.onRunNow(row),
    },
    { key: 'sep', separator: true },
    remove,
  ]
}
