import clsx from 'clsx'
import { Plus } from 'lucide-react'

import { LOCAL_AGENT_PROVIDERS } from '../../../api/local-agent-providers'
import { AgentProviderIcon } from '../../../components/agent/panel/icons'
import { t } from '../../../i18n'
import { agentProvider } from '../../../types/runtime'
import { AGENT_INSTALL } from '../../settings/agentInstall'
import { InstallButton } from '../../settings/InstallAgentButton'
import { PreviewTag } from '../../settings/PreviewTag'
import { InlineSignIn } from '../setup/LocalAgentsStep'
import { rescanRuntimes } from '../setup/runtimeScan'
import { StatusPill } from '../setup/SetupChrome'

import { TILE, TileGrid } from './ComputerCard'
import { installedRuntimes } from './runtimeStatuses'

import type { RuntimeStatuses } from './runtimeStatuses'
import type { LocalAgentProvider } from '../../../api'
import type { LocalAgentStatus } from '../setup/agentSetup'

const STATUS_TEXT: Record<LocalAgentStatus, () => string> = {
  ready: () => t('Signed in and ready to use'),
  checking: () => t('Checking installation and sign-in…'),
  'signed-out': () => t('Sign in to use your subscription'),
  missing: () => t('Install this runtime to get started'),
  found: () => t('Installed. Development builds don’t check sign-in.'),
  unavailable: () => t('Local runtime detection is unavailable'),
}

/** The card holds up to three squares a row. */
const MAX_COLUMNS = 3

/**
 * The runtimes installed on this computer, in the card beside it, then a square to add more. They
 * only show; one not signed in carries a mark. The square opens what can be added, and closes it
 * again. Once `locked`, it can't be pressed.
 */
export function RuntimeTiles({
  statuses,
  adding,
  locked = false,
  onAdd,
}: {
  statuses: RuntimeStatuses
  adding: boolean
  locked?: boolean
  onAdd: () => void
}) {
  const here = installedRuntimes(statuses)

  return (
    <TileGrid label={t('Runtimes')} columns={Math.min(MAX_COLUMNS, here.length + 1)}>
      {here.map((provider) => {
        const status = statuses[provider]
        const label = `${agentProvider(provider).label} · ${STATUS_TEXT[status]()}`

        return (
          <li key={provider} className={clsx(TILE, 'shrink-0')} title={label}>
            <AgentProviderIcon provider={provider} className="h-4 w-4" aria-hidden />
            <span className="sr-only">{label}</span>
            {status === 'signed-out' && (
              <i
                aria-hidden
                className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-warning ring-2 ring-surface"
              />
            )}
          </li>
        )
      })}
      <li className="shrink-0">
        <button
          type="button"
          title={t('Add a runtime')}
          aria-label={t('Add a runtime')}
          aria-expanded={adding}
          disabled={locked}
          onClick={onAdd}
          data-runtime-add=""
          className={clsx(
            TILE,
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-line-focus',
            locked ? 'cursor-default opacity-50' : 'hover:bg-state-hover',
            adding && 'ring-1 ring-line-focus',
          )}
        >
          <Plus strokeWidth={1.75} className="h-4 w-4 text-secondary" />
        </button>
      </li>
    </TileGrid>
  )
}

/** One installed runtime: its state, and signing in from here when it needs that. */
function RuntimeRow({
  provider,
  status,
}: {
  provider: LocalAgentProvider
  status: LocalAgentStatus
}) {
  const { label, preview } = agentProvider(provider)
  const cli = provider === 'claude-code' || provider === 'codex' ? provider : null

  return (
    <li className="space-y-2.5 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-main">
          <AgentProviderIcon provider={provider} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[13.5px] font-medium text-main">
            {label}
            {preview && <PreviewTag />}
          </p>
          <p className="text-[12px] text-tertiary">{STATUS_TEXT[status]()}</p>
        </div>
        <StatusPill status={status} />
      </div>
      {status === 'signed-out' && cli && <InlineSignIn provider={cli} />}
    </li>
  )
}

/** Every runtime installed on this computer, one row each, always in view under the computers. */
export function InstalledRuntimes({ statuses }: { statuses: RuntimeStatuses }) {
  const here = installedRuntimes(statuses)

  return (
    <div
      className="rounded-xl border border-line-control bg-surface-sheet text-left"
      aria-live="polite"
    >
      {here.length === 0 ? (
        <p className="px-4 py-3 text-[12.5px] text-secondary">{t('No runtimes yet.')}</p>
      ) : (
        <ul aria-label={t('Runtimes')} className="divide-y divide-line-control">
          {here.map((provider) => (
            <RuntimeRow key={provider} provider={provider} status={statuses[provider]} />
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * The runtimes this computer doesn't have yet that Nuphos can install, each with its installer.
 * One that finishes installing is looked for again, so it joins the card and the list.
 */
export function AddableRuntimes({ statuses }: { statuses: RuntimeStatuses }) {
  const addable = LOCAL_AGENT_PROVIDERS.filter(
    (provider) => statuses[provider] === 'missing' && AGENT_INSTALL[provider],
  )

  return (
    <div className="flex flex-col pt-3 text-left" aria-live="polite">
      <p className="px-4 text-[12px] font-medium text-tertiary">{t('Runtimes you can add')}</p>
      {addable.length === 0 ? (
        <p className="mt-2 px-4 pb-3 text-[12.5px] text-secondary">
          {t('Every runtime is installed.')}
        </p>
      ) : (
        <ul className="mt-1.5 divide-y divide-line-control/50 px-4 pb-1">
          {addable.map((provider) => {
            const { label, preview } = agentProvider(provider)

            return (
              <li key={provider} className="flex items-center gap-3 py-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-main">
                  <AgentProviderIcon provider={provider} className="h-4 w-4" />
                </span>
                <p className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-[13px] font-medium text-main">
                  {label}
                  {preview && <PreviewTag />}
                </p>
                <InstallButton
                  provider={provider}
                  short
                  quiet
                  onDone={() => void rescanRuntimes().catch(() => null)}
                />
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
