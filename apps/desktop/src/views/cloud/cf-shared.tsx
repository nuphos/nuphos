import { useState } from 'react'

import { Modal } from '../../components/Modal'
import { toast } from '../../components/ui/toast'

import type { CommonProps } from './shared'

export type CfViewProps = CommonProps & { teamId: string; accountId: string }

/**
 * Drill-down selection for a Cloudflare list view, lifted to tab state so the
 * GLOBAL breadcrumb owns the section + leaf chrome (App.tsx). Detail views must
 * NOT render their own section breadcrumb — that produces a double breadcrumb.
 * `name` is the leaf label; `id` is the stable API id when it differs (D1/KV);
 * `prefix` is the R2 object-browser path. When the props are omitted the view
 * falls back to local state so it still works standalone.
 */
export type CfDetailRef = { name: string; id?: string; prefix?: string }
// Controlled as a pair: either both are provided (lifted to tab state) or
// neither (the view falls back to local state). Splitting them would let a
// caller pass a controlled value with no way to change it.
export type CfDrillProps =
  | { detail: CfDetailRef | null; setDetail: (d: CfDetailRef | null) => void }
  | { detail?: undefined; setDetail?: undefined }

/** Top action bar shared by the Cloudflare list views (matches the DNS bar). */
/**
 * Slim right-aligned action bar for a Cloudflare detail view. The detail view's
 * section + leaf live in the GLOBAL breadcrumb (App.tsx), so detail views never
 * render their own breadcrumb — this only carries per-detail actions / status.
 */
export function CfDetailActionBar({ children }: { children?: React.ReactNode }) {
  if (!children) return null

  return (
    <div className="flex items-center justify-end gap-2 px-4 py-2 border-b border-zGray-850 bg-zGray-950 text-[12.5px]">
      {children}
    </div>
  )
}

export function CfMetaRow({
  label,
  value,
  mono,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex items-start gap-3 py-1">
      <span className="w-40 shrink-0 text-[12px] text-tertiary">{label}</span>
      <span className={`text-[12.5px] text-secondary break-all ${mono ? 'font-mono' : ''}`}>
        {value}
      </span>
    </div>
  )
}

// --- Workers ---------------------------------------------------------------

export function CreateNameDialog({
  title,
  label,
  placeholder,
  initial,
  confirmLabel,
  onClose,
  onCreate,
}: {
  title: string
  label: string
  placeholder?: string
  initial?: string
  confirmLabel?: string
  onClose: () => void
  onCreate: (name: string) => Promise<void>
}) {
  const [name, setName] = useState(initial ?? '')
  const [saving, setSaving] = useState(false)

  async function create() {
    if (!name.trim()) {
      toast.error(`${label} is required.`)

      return
    }
    setSaving(true)
    try {
      await onCreate(name.trim())
    } catch (e) {
      toast.apiError('Something went wrong', e, {
        fallback: 'Check your connection and try again.',
      })
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={title} width={440}>
      <div className="px-5 py-4 space-y-2 text-[13px]">
        <label className="block">
          <div className="text-[12px] text-secondary mb-1">{label}</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={placeholder}
            autoFocus
            className="w-full px-2.5 py-1.5 rounded-md bg-field border border-zGray-800 text-main outline-none focus:border-zViolet-accent font-mono text-[12.5px]"
          />
        </label>
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-zGray-800">
        <button
          onClick={onClose}
          disabled={saving}
          className="px-3 py-1.5 rounded-md text-secondary hover:text-main text-[12.5px] disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={() => void create()}
          disabled={saving}
          className="px-3 py-1.5 rounded-md bg-zViolet-500 hover:bg-zViolet-400 text-white text-[12.5px] disabled:opacity-50"
        >
          {saving ? 'Saving…' : (confirmLabel ?? 'Create')}
        </button>
      </div>
    </Modal>
  )
}
