import clsx from 'clsx'

import { Modal } from './Modal'

import type { ReactNode } from 'react'

// One row in the detail panel's definition list. `mono` formats the value in a
// monospace font (useful for IDs, IPs, CIDRs).
export type LeafDetailField = {
  label: string
  value: ReactNode
  mono?: boolean
  // When set, the field spans both columns instead of label/value side-by-side.
  // Use for long values like description text or rule lists.
  full?: boolean
}

type Props = {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  fields: LeafDetailField[]
  // Optional raw JSON dump rendered below the named fields. Off by default.
  raw?: unknown
}

// Generic right-side detail panel for "leaf" table rows that don't have a
// dedicated detail page — VPCs, NACLs, EC2, Lightsail, GCP firewalls, etc.
// Renders the row's noteworthy fields as a definition list inside the shared
// Modal component, so every row has somewhere to go besides the list page.
export function LeafDetailPanel({ open, onClose, title, subtitle, fields, raw }: Props) {
  return (
    <Modal open={open} onClose={onClose} title={title} description={subtitle} width={560}>
      <div className="px-5 py-4 text-[13px]">
        <dl className="grid grid-cols-[140px,1fr] gap-x-4 gap-y-2.5">
          {fields.map((f, i) => (
            <FieldRow key={`${f.label}-${String(i)}`} field={f} />
          ))}
        </dl>
        {raw !== undefined && (
          <details className="mt-5 group">
            <summary className="text-[11.5px] uppercase tracking-wider text-tertiary hover:text-secondary select-none">
              Raw JSON
            </summary>
            {/* No inner scroll: wrap long lines and let the block grow so the
                modal's own outer scrollbar handles it (single scrollbar). */}
            <pre className="mt-2 rounded-md bg-zGray-950 border border-zGray-800 p-3 text-[11.5px] font-mono text-secondary whitespace-pre-wrap break-words">
              {JSON.stringify(raw, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </Modal>
  )
}

function FieldRow({ field }: { field: LeafDetailField }) {
  if (field.full) {
    return (
      <div className="col-span-2 mt-1 first:mt-0">
        <div className="text-[11.5px] uppercase tracking-wider text-tertiary mb-1">
          {field.label}
        </div>
        <div className={clsx(field.mono && 'font-mono text-[12px]', 'text-secondary')}>
          {field.value}
        </div>
      </div>
    )
  }

  return (
    <>
      <dt className="text-tertiary text-[12px] uppercase tracking-wider self-baseline">
        {field.label}
      </dt>
      <dd
        className={clsx(
          'text-secondary break-words self-baseline',
          field.mono && 'font-mono text-[12px]',
        )}
      >
        {field.value}
      </dd>
    </>
  )
}
