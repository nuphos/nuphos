import {
  faArrowUpRightFromSquare,
  faCheck,
  faCopy,
  faDownload,
} from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'
import { useState } from 'react'

import { toast } from './ui/toast'

// Reusable primitives for step-by-step connector onboarding wizards (Lark today;
// any provider that needs a "create an app → paste credentials → configure"
// flow). A wizard owns its own step state/validation/submit; these just give it
// a consistent progress bar, step layout, and the copy/link/download affordances
// every console walkthrough needs.

// Progress bar + "Step N of M · Title" label.
export function WizardStepBar({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center gap-1">
        {steps.map((title, i) => (
          <div
            key={title}
            className={clsx(
              'h-1 flex-1 rounded-full transition-colors',
              i <= current ? 'bg-zViolet-500' : 'bg-zGray-800',
            )}
          />
        ))}
      </div>
      <div className="text-[11px] uppercase tracking-wider text-tertiary">
        Step {current + 1} of {steps.length} · {steps[current]}
      </div>
    </div>
  )
}

// Layout template for one step. Pass `example` (usually <WizardExampleImage/>) to
// get the two-column layout — instructions left, example on the right half.
// Omit it for the plain single-column layout.
export function WizardStep({
  example,
  children,
}: {
  example?: React.ReactNode
  children: React.ReactNode
}) {
  if (!example) return <>{children}</>

  // items-stretch so the example column fills the full height of the taller
  // (instructions) column — WizardExampleImage then object-covers that height.
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_224px] items-stretch gap-4">
      <div className="min-w-0">{children}</div>
      {example}
    </div>
  )
}

export { WizardExampleImage } from './connector-wizard-image'

// Ordered instruction list. `inline` uses list-inside (compact); default uses
// list-outside so block children (buttons, inputs) indent under the marker.
export function WizardStepList({
  children,
  inline,
}: {
  children: React.ReactNode
  inline?: boolean
}) {
  return (
    <ol
      className={clsx(
        'list-decimal text-[12px] leading-relaxed text-secondary marker:text-tertiary',
        inline ? 'list-inside space-y-1.5' : 'list-outside space-y-2.5 pl-4',
      )}
    >
      {children}
    </ol>
  )
}

// External console link (opens in the system browser via the app's window-open
// handler).
export function WizardConsoleLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-7 items-center gap-1.5 rounded-md bg-zGray-800 px-2.5 text-[12px] font-medium text-main no-underline transition-colors hover:bg-zGray-700"
    >
      <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="h-3.5 w-3.5" />
      {children}
    </a>
  )
}

// Download a bundled asset (e.g. a logo to upload into the provider console).
export function WizardDownloadLink({
  href,
  download,
  children,
}: {
  href: string
  download: string
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      download={download}
      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-zGray-800 px-2.5 text-[12px] font-medium text-secondary no-underline transition-colors hover:border-zGray-700 hover:text-main"
    >
      <FontAwesomeIcon icon={faDownload} className="h-3.5 w-3.5" />
      {children}
    </a>
  )
}

// A monospace chip that copies its value on click — for exact values the user
// must paste into the provider console (app name, scopes, event ids, etc.).
export function WizardCopyableValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not copy')
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title="Copy"
      className="inline-flex max-w-full items-center gap-1.5 rounded border border-zGray-800 bg-zGray-850 px-1.5 py-0.5 align-middle font-mono text-[11.5px] text-main transition-colors hover:border-zGray-700"
    >
      <span className="truncate">{value}</span>
      <FontAwesomeIcon
        icon={copied ? faCheck : faCopy}
        className={clsx('h-3 w-3 flex-shrink-0', copied ? 'text-zViolet-accent' : 'text-tertiary')}
      />
    </button>
  )
}

// A multi-line copyable block (JSON, YAML, config) with a copy button — for
// values too big to paste as an inline chip, e.g. a batch scope-import payload.
export function WizardCopyableBlock({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not copy')
    }
  }

  return (
    <div className="relative rounded-md border border-zGray-800 bg-zGray-900">
      <button
        type="button"
        onClick={() => void copy()}
        className="absolute right-2 top-2 inline-flex h-6 items-center gap-1 rounded border border-zGray-800 bg-zGray-850 px-1.5 text-[11px] font-medium text-secondary transition-colors hover:border-zGray-700 hover:text-main"
      >
        <FontAwesomeIcon icon={copied ? faCheck : faCopy} className="h-3 w-3" />
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre className="overflow-x-auto whitespace-pre p-3 pr-16 font-mono text-[11px] leading-relaxed text-main">
        {value}
      </pre>
    </div>
  )
}
