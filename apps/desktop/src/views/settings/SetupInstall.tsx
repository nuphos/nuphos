import { Check, Clock, Copy, Laptop } from 'lucide-react'
import { useState } from 'react'

import { AgentProviderIcon } from '../../components/agent/panel/icons'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { agentProvider } from '../../types/runtime'

import { AGENT_INSTALL } from './agentInstall'

import type { RuntimeInstance } from '../../types/runtime'

/** An install still running after this says that it is. */
const SLOW_AFTER = 20_000

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(
          () => setCopied(true),
          () => toast.error(t('Could not copy')),
        )
      }}
      className="flex shrink-0 items-center gap-1 text-xs text-secondary hover:text-main"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? t('Copied') : t('Copy')}
    </button>
  )
}

export function Bar() {
  return (
    <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-state-selected" aria-hidden>
      <div className="setup-bar h-full w-1/3 rounded-full" />
    </div>
  )
}

/** Where the agent comes from and where it goes, while its installer runs. */
export function Installing({
  instance,
  ms,
  bar,
}: {
  instance: RuntimeInstance
  ms: number
  bar: boolean
}) {
  const name = agentProvider(instance.provider).label
  const install = AGENT_INSTALL[instance.provider]

  return (
    <div className="mt-2">
      {install && (
        <div className="flex items-center gap-3 rounded-lg border border-line-control px-3 py-2.5">
          <AgentProviderIcon provider={instance.provider} className="h-5 w-5 shrink-0" />
          <div className="min-w-0">
            <div className="truncate text-[13px] text-main">{name}</div>
            <div className="truncate text-xs text-tertiary">{install.maker}</div>
          </div>
          <span className="flex-1 border-t border-dashed border-line-control" aria-hidden />
          <Laptop className="h-5 w-5 shrink-0 text-secondary" />
          <div className="min-w-0 truncate text-[13px] text-main">
            {instance.local?.deviceLabel}
          </div>
        </div>
      )}
      {bar && <Bar />}
      <div className="mt-1.5 flex justify-between gap-3 text-xs text-tertiary">
        <span>{t('Downloading and installing')}</span>
        <span>{t('Usually under a minute')}</span>
      </div>
      {install && ms >= SLOW_AFTER && (
        <p className="mt-3 flex gap-2 rounded-lg bg-state-selected px-3 py-2 text-xs leading-5 text-secondary">
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t(
            'Still going. {name} downloads from {maker} first, so on a slow connection this can take a minute or two. It keeps going on its own; nothing to do here.',
            { name, maker: install.maker },
          )}
        </p>
      )}
    </div>
  )
}

/** An installer that stopped: the way to install by hand, and what it said. */
export function InstallFailed({ instance, error }: { instance: RuntimeInstance; error: string }) {
  const name = agentProvider(instance.provider).label
  const command = AGENT_INSTALL[instance.provider]?.install

  return (
    <div className="mt-2 space-y-2">
      <p className="text-[13px] leading-5 text-secondary">
        {t(
          'The installer exited before {name} was ready. You can also install it yourself on this computer, then try again.',
          { name },
        )}
      </p>
      {command && (
        <div className="flex items-center gap-3 rounded-lg border border-line-control bg-state-selected px-3 py-2">
          <code className="min-w-0 flex-1 break-words font-mono text-xs text-main select-text">
            {command}
          </code>
          <CopyButton text={command} label={t('Copy install command')} />
        </div>
      )}
      <details className="rounded-lg border border-line-control text-xs">
        <summary className="cursor-pointer px-3 py-2 text-secondary">{t('Details')}</summary>
        <div className="flex items-start gap-3 border-t border-line-control px-3 py-2">
          <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-tertiary select-text">
            {error}
          </pre>
          <CopyButton text={error} label={t('Copy error details')} />
        </div>
      </details>
    </div>
  )
}
