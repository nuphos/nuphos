import clsx from 'clsx'
import { Copy, Eye, EyeOff, Pencil, Plus, Trash2 } from 'lucide-react'

import type { KeyEntry } from './config-secret-model'

export function MetadataPills({
  labels,
  annotations,
}: {
  labels: Record<string, string>
  annotations: Record<string, string>
}) {
  const rows = [
    { label: 'Labels', values: Object.entries(labels).map(([k, v]) => `${k}: ${v}`) },
    { label: 'Annotations', values: Object.keys(annotations) },
  ]

  if (rows.every((row) => row.values.length === 0)) return null

  return (
    <div className="space-y-3">
      {rows.map((row) =>
        row.values.length > 0 ? (
          <div key={row.label}>
            <div className="mb-1.5 text-[11.5px] uppercase tracking-wider text-tertiary">
              {row.label}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {row.values.slice(0, 12).map((value) => (
                <span
                  key={value}
                  className="max-w-full truncate rounded bg-zGray-850 px-1.5 py-0.5 font-mono text-[11.5px] text-secondary"
                  title={value}
                >
                  {value}
                </span>
              ))}
              {row.values.length > 12 && (
                <span className="text-[11.5px] text-tertiary">+{row.values.length - 12} more</span>
              )}
            </div>
          </div>
        ) : null,
      )}
    </div>
  )
}

export function KeyTable({
  title,
  keys,
  empty,
  redacted = false,
  revealedIds,
  copiedId,
  addDisabled,
  onAdd,
  onCopy,
  onEdit,
  onRemove,
  onToggleReveal,
}: {
  title: string
  keys: KeyEntry[]
  empty: string
  redacted?: boolean
  revealedIds?: Set<string>
  copiedId?: string | null
  addDisabled?: boolean
  onAdd?: () => void
  onCopy?: (entry: KeyEntry) => void
  onEdit?: (entry: KeyEntry) => void
  onRemove?: (entry: KeyEntry) => void
  onToggleReveal?: (entry: KeyEntry) => void
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-[11.5px] uppercase tracking-wider text-tertiary">{title}</div>
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            disabled={addDisabled}
            className="inline-flex h-7 items-center gap-1.5 rounded bg-zGray-800 px-2.5 text-[12px] text-main hover:bg-zGray-750 disabled:opacity-45 disabled:hover:bg-zGray-800"
            title={addDisabled ? 'Immutable resources cannot be edited' : 'Add key'}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            Add key
          </button>
        )}
      </div>
      {keys.length === 0 ? (
        <div className="border border-zGray-800 bg-zGray-900 px-4 py-5 text-[12.5px] text-tertiary">
          {empty}
        </div>
      ) : (
        <div className="overflow-hidden border border-zGray-800">
          <div className="grid grid-cols-[minmax(150px,1.1fr)_110px_90px_minmax(180px,2fr)_132px] border-b border-zGray-800 bg-zGray-900 px-3 py-2 text-[11.5px] uppercase tracking-wider text-tertiary">
            <div>Key</div>
            <div>Source</div>
            <div>Size</div>
            <div>{redacted ? 'Value' : 'Preview'}</div>
            <div className="text-right">Actions</div>
          </div>
          {keys.map((entry) => (
            <div
              key={`${entry.source}:${entry.key}`}
              className="grid grid-cols-[minmax(150px,1.1fr)_110px_90px_minmax(180px,2fr)_132px] items-center border-b border-zGray-850 px-3 py-2 text-[12.5px] last:border-b-0"
            >
              <div className="min-w-0 truncate font-mono text-main" title={entry.key}>
                {entry.key}
              </div>
              <div className="font-mono text-[12px] text-tertiary">{entry.source}</div>
              <div className="font-mono text-[12px] text-secondary">{entry.size}</div>
              <div className="min-w-0 truncate text-tertiary">
                {redacted && !revealedIds?.has(entry.id) ? 'Hidden' : entry.preview || '-'}
              </div>
              <div className="flex justify-end gap-1">
                {redacted && onToggleReveal && (
                  <IconButton
                    title={revealedIds?.has(entry.id) ? 'Hide value' : 'Reveal value'}
                    onClick={() => onToggleReveal(entry)}
                  >
                    {revealedIds?.has(entry.id) ? (
                      <EyeOff className="h-3.5 w-3.5" strokeWidth={2} />
                    ) : (
                      <Eye className="h-3.5 w-3.5" strokeWidth={2} />
                    )}
                  </IconButton>
                )}
                {onCopy && (
                  <IconButton
                    title={copiedId === entry.id ? 'Copied' : 'Copy value'}
                    onClick={() => onCopy(entry)}
                  >
                    <Copy
                      className={clsx(
                        'h-3.5 w-3.5',
                        copiedId === entry.id && 'text-zViolet-accent',
                      )}
                      strokeWidth={2}
                    />
                  </IconButton>
                )}
                {onEdit && entry.editable && (
                  <IconButton title="Edit key" onClick={() => onEdit(entry)}>
                    <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                  </IconButton>
                )}
                {onRemove && entry.removable && (
                  <IconButton title="Remove key" onClick={() => onRemove(entry)} danger>
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                  </IconButton>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function IconButton({
  title,
  onClick,
  children,
  danger = false,
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
  danger?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={clsx(
        'flex h-7 w-7 items-center justify-center rounded text-tertiary hover:bg-zGray-800 hover:text-main',
        danger && 'hover:bg-error/15 hover:text-error',
      )}
    >
      {children}
    </button>
  )
}
