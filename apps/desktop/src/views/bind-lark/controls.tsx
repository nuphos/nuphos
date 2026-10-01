import { faCheck, faCopy } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'
import { useState } from 'react'

import { toast } from '../../components/ui/toast'

export function WebhookRow({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not copy', 'Copy the URL manually.')
    }
  }

  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md border border-zGray-800 bg-zGray-900 px-2.5 py-2 text-[12px] text-main">
        {url}
      </code>
      <button
        type="button"
        onClick={() => void copy()}
        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-zGray-800 px-3 text-[12px] font-medium text-secondary transition-colors hover:border-zGray-700 hover:text-main"
      >
        <FontAwesomeIcon icon={copied ? faCheck : faCopy} className="h-3 w-3" />
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[11.5px] font-medium text-secondary">{label}</label>
      {children}
    </div>
  )
}

export function Input({
  value,
  onChange,
  placeholder,
  mono,
  secret,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
  secret?: boolean
}) {
  return (
    <input
      type={secret ? 'password' : 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete="off"
      className={clsx(
        'h-9 w-full rounded-md border border-zGray-800 bg-zGray-900 px-2.5 text-[12.5px] text-main outline-none transition-colors placeholder:text-zGray-600 focus:border-zViolet-500',
        mono && 'font-mono',
      )}
    />
  )
}
