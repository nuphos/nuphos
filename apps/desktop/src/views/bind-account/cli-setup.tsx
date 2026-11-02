import { ArrowRight, Check, LoaderCircle, MessageSquare, Terminal } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { CloudLogo } from '../../components/CloudLogo'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { CLOUD_CLIS, cloudCliSetupPrompt } from '../../lib/cloudCli'

import type { useCloudCliCheck } from './use-cloud-cli-check'
import type { CloudCliProvider } from '../../lib/cloudCli'

export function CloudCliSetupChoice({
  provider,
  teamId,
  check,
  onOpenAgentChat,
  onStarted,
}: {
  provider: CloudCliProvider
  teamId: string
  check: ReturnType<typeof useCloudCliCheck>
  onOpenAgentChat: (prompt: string) => void
  onStarted: () => void
}) {
  const [starting, setStarting] = useState(false)
  const label = CLOUD_CLIS[provider].label

  async function start() {
    if (starting || !check.result?.installed) return
    setStarting(true)
    try {
      const device = await api.deviceGetIdentity()

      onOpenAgentChat(cloudCliSetupPrompt(provider, teamId, check.result, device))
      onStarted()
    } catch (error) {
      toast.apiError(t('Could not start setup'), error, {
        fallback: t('Try again or continue with manual setup.'),
      })
    } finally {
      setStarting(false)
    }
  }

  const steps = [
    {
      title: t('Check your account'),
      detail: t('Confirm your sign-in and the account to connect.'),
    },
    {
      title: t('Set up the connection'),
      detail: t('Configure the access needed for your tasks.'),
    },
    {
      title: t('Verify and connect'),
      detail: t('Test the connection and save it to your workspace.'),
    },
  ]

  return (
    <div className="pb-1 pt-2" aria-busy={check.checking || starting}>
      <div className="pb-5">
        <h3 className="text-[22px] font-semibold leading-[1.25] tracking-[-0.025em] text-main">
          {check.checking ? t('A quicker way to connect.') : t('Let Nuphos take it from here.')}
        </h3>
        <p className="mt-2 text-[13px] leading-relaxed text-secondary">
          {check.checking
            ? t('Looking for the {name} command-line tool on this computer.', { name: label })
            : t(
                'We found the {name} CLI on this computer. The agent can walk through setup with you, right in a new agent.',
                { name: label },
              )}
        </p>
      </div>

      <div className="mb-6 overflow-hidden rounded-xl border border-zGray-800/70 bg-zGray-950/40">
        <div className="flex items-center gap-3 px-3.5 py-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zGray-800/70 bg-surface">
            <CloudLogo provider={provider} size={24} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-medium text-main">{label} CLI</div>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-tertiary">
              <Terminal className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate font-mono">
                {check.result?.command ?? CLOUD_CLIS[provider].commands[0]}
              </span>
              <span aria-hidden="true">·</span>
              <span>{t('This computer')}</span>
            </div>
          </div>
          <div
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-zGray-800/60 px-2 py-1 text-[10px] font-medium text-secondary"
            role="status"
          >
            {check.checking ? (
              <LoaderCircle
                className="h-3 w-3 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <Check className="h-3 w-3 text-success" strokeWidth={2.5} aria-hidden="true" />
            )}
            {check.checking ? t('Checking') : t('Detected')}
          </div>
        </div>
        {!check.checking && check.result?.installed && (
          <dl className="space-y-2 border-t border-zGray-800/60 px-3.5 py-3 text-[11px]">
            <div className="flex items-baseline gap-3">
              <dt className="w-12 shrink-0 text-tertiary">{t('Path')}</dt>
              <dd className="min-w-0 select-text break-all font-mono leading-relaxed text-secondary">
                {check.result.path ?? t('Unavailable')}
              </dd>
            </div>
            <div className="flex items-baseline gap-3">
              <dt className="w-12 shrink-0 text-tertiary">{t('Version')}</dt>
              <dd className="select-text font-mono text-secondary">
                {check.versionLoading
                  ? t('Reading…')
                  : check.versionRequested
                    ? (check.result.version ?? t('Could not read version'))
                    : null}
                {!check.versionLoading && !check.result.version && (
                  <button
                    type="button"
                    onClick={check.retryVersion}
                    title={
                      check.result.path
                        ? t('Run {command} version command at {path}', {
                            command: check.result.command ?? 'CLI',
                            path: check.result.path,
                          })
                        : t('Run {command} version command at the detected path', {
                            command: check.result.command ?? 'CLI',
                          })
                    }
                    className={`${check.versionRequested ? 'ml-2 ' : ''}font-sans text-zViolet-accent hover:underline`}
                  >
                    {check.versionRequested ? t('Retry') : t('Read version')}
                  </button>
                )}
              </dd>
            </div>
          </dl>
        )}
      </div>

      {!check.checking && (
        <ol className="mb-6 space-y-0">
          {steps.map((step, index) => (
            <li key={step.title} className="relative flex gap-3 pb-4 last:pb-0">
              {index < steps.length - 1 && (
                <div
                  aria-hidden="true"
                  className="absolute bottom-0 left-[11px] top-6 w-px bg-zGray-800"
                />
              )}
              <span
                aria-hidden="true"
                className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-zGray-800 bg-surface text-[10px] font-medium tabular-nums text-tertiary"
              >
                {index + 1}
              </span>
              <div className="min-w-0 pt-0.5">
                <div className="text-[12px] font-medium leading-4 text-main">{step.title}</div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-tertiary">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      )}

      {!check.checking && (
        <div>
          <Button
            size="md"
            className="w-full"
            type="button"
            onClick={() => void start()}
            disabled={starting}
          >
            {starting ? (
              <LoaderCircle
                className="h-4 w-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
            )}
            {starting ? t('Opening your agent…') : t('Set up with agent')}
            {!starting && <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />}
          </Button>
          <p className="mt-2 text-center text-[10.5px] text-tertiary">
            {t('Opens a new agent on this computer')}
          </p>
        </div>
      )}

      <div className="mt-5 border-t border-zGray-800/60 pt-3">
        <button
          type="button"
          onClick={check.continueManually}
          disabled={starting}
          className="flex min-h-8 w-full items-center justify-between gap-3 rounded-md px-1 text-left text-[12px] text-secondary hover:text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-zViolet-accent disabled:opacity-50"
        >
          <span>
            {check.checking ? t('Continue with manual setup') : t('Set up manually instead')}
          </span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-tertiary" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
