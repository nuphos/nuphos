import { faArrowUpRightFromSquare, faEye, faLink, faTrash } from '@fortawesome/free-solid-svg-icons'

import { api } from '../../api'
import { PROVIDER_LABEL } from '../../lib/monitoringWatch'

import type { ContextMenuItem } from '../../components/ContextMenu'
import type { MonitoringOverviewRow } from '../../types'

// Grafana rows are only deletable when they carry a real provisioning uid;
// the synthesized fallback id (folder/group/name) contains '/' and has no
// corresponding provisioning resource.
function isDeletable(r: MonitoringOverviewRow): boolean {
  if (r.provider === 'betterstack') return true
  // GCP rows are read-only here — manage policies in the Cloud Console
  // (providerUrl) or through the agent.
  if (r.provider === 'gcp') return false

  return r.kind === 'alert-rule' && !r.providerResourceId.includes('/')
}

// Right-click menu — same interaction model as the k8s resource lists.
// ContextMenu's built-in `confirm` handles the destructive prompt.
export function menuItems(
  row: MonitoringOverviewRow,
  deleteRow: (row: MonitoringOverviewRow) => Promise<void>,
  copyRowLink: () => Promise<void>,
  onWatch?: (row: MonitoringOverviewRow) => void,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    {
      key: 'copy-link',
      label: 'Copy link',
      icon: faLink,
      onSelect: copyRowLink,
    },
  ]

  if (onWatch) {
    items.push({
      key: 'watch',
      label: 'Watch with Agent',
      icon: faEye,
      onSelect: () => onWatch(row),
    })
  }
  if (row.providerUrl) {
    items.push({
      key: 'open',
      label: `Open in ${PROVIDER_LABEL[row.provider]}`,
      icon: faArrowUpRightFromSquare,
      onSelect: () => void api.appOpenExternal(row.providerUrl!),
    })
  }
  if (isDeletable(row)) {
    if (items.length > 0) items.push({ key: 'sep', separator: true })
    items.push({
      key: 'delete',
      label: 'Delete',
      icon: faTrash,
      destructive: true,
      confirm: `Delete "${row.name}" from ${PROVIDER_LABEL[row.provider]}? This removes it in the provider itself and cannot be undone.`,
      onSelect: () => deleteRow(row),
    })
  }

  return items
}

export function formatRelative(iso: string | null): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()

  if (!Number.isFinite(then)) return '—'
  const diff = Date.now() - then

  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${String(Math.floor(diff / 60_000))}m ago`
  if (diff < 86_400_000) return `${String(Math.floor(diff / 3_600_000))}h ago`

  return `${String(Math.floor(diff / 86_400_000))}d ago`
}
