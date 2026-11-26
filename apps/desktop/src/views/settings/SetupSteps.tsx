import { Check, Loader2, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { formatElapsed } from '../../components/agent/panel/voiceDictation'
import { t } from '../../i18n'
import { agentProvider } from '../../types/runtime'

import { Bar, InstallFailed, Installing } from './SetupInstall'

import type { RuntimeLogin } from './useRuntimeLogin'
import type { RuntimeInstance, RuntimeLoginStatus } from '../../types/runtime'
import type { ReactNode } from 'react'

type Phase = 'start' | 'install' | 'signin'
type Status = 'pending' | 'active' | 'done' | 'failed'
type Since = Partial<Record<Phase, { from: number; to?: number }>>

const PHASES: Phase[] = ['start', 'install', 'signin']
/** A finished step keeps its check this long before the next one starts. */
const HOLD = 600
/** Under these, a quick step shows neither a bar nor a count. */
const BAR_AFTER = 400
const COUNT_AFTER = 5_000

function phaseOf(login: RuntimeLoginStatus | null): Phase {
  if (!login) return 'start'

  return login.installing ? 'install' : 'signin'
}

/** Ends the step that ran and starts `next`; null when the attempt failed. */
function advance(since: Since, next: Phase | null, at: number): Since {
  const result: Since = {}

  for (const step of PHASES) {
    const time = since[step]

    if (time) result[step] = time.to === undefined ? { ...time, to: at } : time
  }
  if (next) result[next] = since[next] ?? { from: at }

  return result
}

function Mark({ status }: { status: Status }) {
  if (status === 'pending')
    return <span className="h-5 w-5 rounded-full border border-dashed border-line-control" />
  if (status === 'active')
    return <Loader2 className="h-5 w-5 animate-spin text-secondary motion-reduce:animate-none" />
  const Icon = status === 'done' ? Check : X

  return (
    <span
      className={`flex h-5 w-5 items-center justify-center rounded-full text-white ${status === 'done' ? 'bg-success' : 'bg-error'}`}
    >
      <Icon className="h-3 w-3" strokeWidth={3} />
    </span>
  )
}

const TITLE_CLASS: Record<Status, string> = {
  pending: 'text-tertiary',
  active: 'font-medium text-main',
  done: 'font-medium text-main',
  failed: 'font-medium text-error',
}

/**
 * A runtime's setup as three steps: start it, install its agent, sign in. Each step shows how
 * long it took; the sign-in's own prompts (`children`) sit under the last one. A failure is
 * placed here, as the runtime does not say: an attempt that installed and then failed before
 * asking for a sign-in failed in its installer.
 */
export function SetupSteps({
  instance,
  state,
  children,
}: {
  instance: RuntimeInstance
  state: RuntimeLogin
  children: ReactNode
}) {
  const { login, error, failed, awaiting, reachable } = state
  const { label: name, account } = agentProvider(instance.provider)
  const computer = instance.local?.deviceLabel ?? ''
  const phase = phaseOf(login)
  const running = failed ? null : phase
  const [now, setNow] = useState(Date.now)
  const [track, setTrack] = useState(() => ({
    running,
    since: advance({}, phase, Date.now()),
    asked: false,
  }))
  const [shown, setShown] = useState(phase)

  // Each step's time runs from when it began to when the next one did, or the attempt failed.
  if (track.running !== running || (awaiting && !track.asked))
    setTrack({
      running,
      since: track.running === running ? track.since : advance(track.since, running, now),
      asked: track.asked || awaiting,
    })

  useEffect(() => {
    if (shown === phase) return
    const timer = setTimeout(() => setShown(phase), HOLD)

    return () => clearTimeout(timer)
  }, [phase, shown])

  // The clock ticks while the attempt runs; steps start and end on its ticks.
  useEffect(() => {
    if (failed) return
    const timer = setInterval(() => setNow(Date.now()), 200)

    return () => clearInterval(timer)
  }, [failed])

  let broke: Phase | null = null

  if (failed) broke = phase === 'start' ? 'start' : 'signin'
  if (broke === 'signin' && track.since.install && !track.asked) broke = 'install'

  const status = (step: Phase): Status => {
    const at = PHASES.indexOf(step)
    const edge = PHASES.indexOf(broke ?? shown)

    if (at > edge) return 'pending'
    if (broke) return at === edge ? 'failed' : 'done'
    if (at < edge || PHASES.indexOf(phase) > at) return 'done'

    return 'active'
  }
  const reason = login?.error ?? error ?? t('Sign-in was cancelled.')

  const title: Record<Phase, Record<Status, string>> = {
    start: {
      pending: t('Start the runtime on {computer}', { computer }),
      active: t('Starting the runtime on {computer}', { computer }),
      done: t('Runtime started on {computer}', { computer }),
      failed: t('The runtime did not start on {computer}', { computer }),
    },
    install: {
      pending: t('Install {name}', { name }),
      active: t('Installing {name}', { name }),
      done: t('{name} installed', { name }),
      failed: t('{name}’s installer stopped', { name }),
    },
    signin: {
      pending: t('Sign in with {account}', { account }),
      active: t('Sign in with {account}', { account }),
      done: t('Signed in with {account}', { account }),
      failed: t('Sign-in did not finish'),
    },
  }

  const body = (step: Phase, current: Status, ms: number): ReactNode => {
    if (current === 'failed' && step === 'install')
      return <InstallFailed instance={instance} error={reason} />
    if (current === 'failed')
      return <p className="mt-1 text-[13px] leading-5 text-error">{reason}</p>
    if (current !== 'active') return null
    if (step === 'install') return <Installing instance={instance} ms={ms} bar={ms >= BAR_AFTER} />
    if (step === 'signin' && children) return <div className="mt-3 space-y-4">{children}</div>

    return (
      <>
        {ms >= BAR_AFTER && <Bar />}
        {step === 'start' && !reachable && (
          <p className="mt-2 text-xs leading-5 text-tertiary">
            {t('You can close this and sign in from its card once it is running.')}
          </p>
        )}
      </>
    )
  }

  return (
    <ol className="flex flex-col">
      {PHASES.map((step, index) => {
        const current = status(step)
        const time = track.since[step]
        const ms = time ? (time.to ?? now) - time.from : 0
        const last = index === PHASES.length - 1

        return (
          <li key={step} className="flex gap-3" aria-current={current === 'active' || undefined}>
            <div className="flex flex-col items-center">
              <Mark status={current} />
              {!last && (
                <span
                  className={`my-1 w-px flex-1 ${current === 'done' ? 'bg-success' : 'bg-line'}`}
                />
              )}
            </div>
            <div className={`min-w-0 flex-1 ${last ? '' : 'pb-5'}`}>
              <div className="flex items-baseline justify-between gap-3">
                <span className={`text-[13px] leading-5 ${TITLE_CLASS[current]}`}>
                  {title[step][current]}
                </span>
                {current !== 'pending' && ms >= COUNT_AFTER && (
                  <span className="shrink-0 text-xs tabular-nums text-tertiary">
                    {formatElapsed(ms)}
                  </span>
                )}
              </div>
              {body(step, current, ms)}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
