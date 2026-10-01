import { faArrowUpRightFromSquare, faCheck, faCopy } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'
import { useState } from 'react'

import { toast } from '../../components/ui/toast'

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-3 last:mb-0">
      <label className="block text-[11.5px] uppercase tracking-wider text-tertiary font-medium mb-1.5">
        {label}
      </label>
      {children}
      {hint && <div className="text-[11.5px] text-tertiary mt-1">{hint}</div>}
    </div>
  )
}

// `label`, when given, is shown on the button instead of the value itself —
// used for large/multi-line values (e.g. a policy JSON) that are rendered
// elsewhere and just need a copy affordance.
export function CopyableValue({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not copy', 'Clipboard was blocked.')
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title="Copy"
      className="inline-flex items-center gap-1.5 max-w-full px-1.5 py-0.5 rounded bg-zGray-850 border border-zGray-800 hover:border-zGray-700 font-mono text-[11.5px] text-main transition-colors align-middle"
    >
      <span className="truncate">{copied && label ? 'Copied' : (label ?? value)}</span>
      <FontAwesomeIcon
        icon={copied ? faCheck : faCopy}
        className={clsx('w-3 h-3 flex-shrink-0', copied ? 'text-zViolet-accent' : 'text-tertiary')}
      />
    </button>
  )
}

export function ConsoleLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="h-7 px-2.5 rounded-md bg-zGray-800 hover:bg-zGray-700 text-main text-[12px] font-medium inline-flex items-center gap-1.5 no-underline align-middle"
    >
      {children}
      <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="w-3.5 h-3.5 flex-shrink-0" />
    </a>
  )
}

export function StepList({ children }: { children: React.ReactNode }) {
  return (
    <ol className="text-[12px] text-secondary leading-relaxed space-y-1.5 list-decimal list-inside marker:text-tertiary">
      {children}
    </ol>
  )
}

/** The aside under a StepList — why this step is shaped the way it is, or what
 *  to expect from it. Quieter than the moves it follows, because it is not one
 *  of them. */
export function StepNote({ children }: { children: React.ReactNode }) {
  return <div className="text-[11.5px] text-tertiary leading-relaxed">{children}</div>
}

// Icon-only copy button, meant to sit absolutely in the top-right corner of a
// code block.
export function CopyIconButton({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not copy', 'Clipboard was blocked.')
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title="Copy"
      className={clsx(
        'flex h-6 w-6 items-center justify-center rounded bg-zGray-850 border border-zGray-800 hover:border-zGray-700 transition-colors',
        className,
      )}
    >
      <FontAwesomeIcon
        icon={copied ? faCheck : faCopy}
        className={clsx('w-3 h-3', copied ? 'text-zViolet-accent' : 'text-tertiary')}
      />
    </button>
  )
}

// A copyable shell command in a code block with a corner copy button.
export function CommandBlock({ command }: { command: string }) {
  return (
    <div className="relative mt-1.5">
      <pre className="border border-zGray-800 bg-zGray-950 rounded-md py-2 pl-2.5 pr-9 text-[11px] font-mono text-secondary overflow-x-auto whitespace-pre">
        {command}
      </pre>
      <CopyIconButton value={command} className="absolute right-1.5 top-1.5" />
    </div>
  )
}
