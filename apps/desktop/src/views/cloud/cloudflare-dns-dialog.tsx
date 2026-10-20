import { useState } from 'react'

import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { fieldClass } from '../../components/ui/input-group'
import { AppSelect } from '../../components/ui/select'
import { useResetOnKey } from '../useResetOnKey'

import type { CloudflareDnsRecord, CloudflareDnsRecordInput } from '../../types'
import type { FormEvent } from 'react'

const DNS_RECORD_TYPES = [
  'A',
  'AAAA',
  'CNAME',
  'TXT',
  'MX',
  'NS',
  'CAA',
  'SRV',
  'PTR',
  'HTTPS',
  'SVCB',
  'TLSA',
  'SSHFP',
  'URI',
]

function canProxyRecord(type: string): boolean {
  return type === 'A' || type === 'AAAA' || type === 'CNAME'
}

export function DnsRecordDialog({
  open,
  zoneName,
  record,
  onClose,
  onSubmit,
}: {
  open: boolean
  zoneName: string
  record: CloudflareDnsRecord | null
  onClose: () => void
  onSubmit: (input: CloudflareDnsRecordInput) => Promise<void>
}) {
  const [type, setType] = useState(record?.type ?? 'A')
  const [name, setName] = useState(record?.name ?? '')
  const [content, setContent] = useState(record?.content ?? '')
  const [ttl, setTtl] = useState(String(record?.ttl ?? 1))
  const [proxied, setProxied] = useState(record?.proxied ?? false)
  const [priority, setPriority] = useState(record?.priority != null ? String(record.priority) : '')
  const [comment, setComment] = useState(record?.comment ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Seed the fields from `record` on every open. Keyed on the record id rather
  // than its identity so a background refresh of the zone can't stomp edits in
  // an already-open dialog.
  useResetOnKey(`${String(open)}|${record?.id ?? ''}`, () => {
    if (!open) return
    setType(record?.type ?? 'A')
    setName(record?.name ?? '')
    setContent(record?.content ?? '')
    setTtl(String(record?.ttl ?? 1))
    setProxied(record?.proxied ?? false)
    setPriority(record?.priority != null ? String(record.priority) : '')
    setComment(record?.comment ?? '')
    setSaving(false)
    setError(null)
  })

  if (!open) return null

  const proxyCapable = canProxyRecord(type)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const parsedTtl = Number(ttl)
    const parsedPriority = priority.trim() ? Number(priority) : undefined

    if (!name.trim() || !content.trim()) {
      setError('Name and content are required.')

      return
    }
    if (!Number.isInteger(parsedTtl) || parsedTtl < 1) {
      setError('TTL must be a positive integer. Use 1 for Auto.')

      return
    }
    if (parsedPriority !== undefined && (!Number.isInteger(parsedPriority) || parsedPriority < 0)) {
      setError('Priority must be a non-negative integer.')

      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSubmit({
        type,
        name: name.trim(),
        content: content.trim(),
        ttl: parsedTtl,
        ...(proxyCapable ? { proxied } : {}),
        ...(parsedPriority !== undefined ? { priority: parsedPriority } : {}),
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      })
    } catch (e2) {
      setError(String(e2 instanceof Error ? e2.message : e2))
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={record ? 'Edit DNS record' : 'Add DNS record'}
      description={zoneName}
      width={520}
      closeOnBackdrop={false}
      footer={
        <div className="flex justify-end gap-2 px-5 py-3">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="cloudflare-dns-record" size="sm" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      }
    >
      <form id="cloudflare-dns-record" onSubmit={(e) => void submit(e)}>
        <div className="grid grid-cols-2 gap-3 px-5 py-4">
          <label className="flex flex-col gap-1 text-[12px] text-secondary">
            Type
            <AppSelect
              value={type}
              onValueChange={setType}
              options={DNS_RECORD_TYPES.map((t) => ({ value: t, label: t }))}
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-secondary">
            TTL
            <input
              value={ttl}
              onChange={(e) => setTtl(e.target.value)}
              inputMode="numeric"
              className={`${fieldClass} h-9`}
              placeholder="1"
            />
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-[12px] text-secondary">
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`${fieldClass} h-9`}
              placeholder={`www.${zoneName}`}
            />
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-[12px] text-secondary">
            Content
            <input
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className={`${fieldClass} h-9`}
              placeholder="192.0.2.1"
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-secondary">
            Priority
            <input
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              inputMode="numeric"
              className={`${fieldClass} h-9`}
              placeholder="MX/SRV only"
            />
          </label>
          <label className="flex items-end gap-2 pb-1 text-[12px] text-secondary">
            <input
              type="checkbox"
              checked={proxied}
              disabled={!proxyCapable}
              onChange={(e) => setProxied(e.target.checked)}
              className="h-4 w-4 rounded border-zGray-700 bg-zGray-950"
            />
            Proxied
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-[12px] text-secondary">
            Comment
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className={`${fieldClass} h-9`}
              placeholder="Optional"
            />
          </label>
          {error && <div className="col-span-2 text-[12px] text-error">{error}</div>}
        </div>
      </form>
    </Modal>
  )
}
