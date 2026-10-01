import { faSpinner } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'
import { RotateCcw } from 'lucide-react'

import { track } from '../../../lib/analytics'

import { FRESH_FIRST_QUESTION } from './progress'

import type { Purpose, Stage } from './progress'
import type { FirstRunProvider } from '../../../lib/firstRunConnect'
import type { Dispatch, SetStateAction } from 'react'

export function Footer({
  stage,
  setupStep,
  setupTotal,
  advancing,
  submitting,
  canSubmit,
  onBack,
  onContinue,
  onAdvance,
  onSubmit,
  onStartOver,
  onFinish,
}: {
  stage: Stage
  setupStep: number
  setupTotal: number
  advancing: boolean
  submitting: boolean
  canSubmit: boolean
  onBack: () => void
  onContinue: () => void
  onAdvance: () => void
  onSubmit: () => void
  onStartOver: () => void
  onFinish: () => void
}) {
  return (
    <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-zGray-800/60 px-3 py-2.5">
      {/* The first screen has nothing behind it, so no Back. Continue is here
          from the start, disabled until a cloud is picked: an empty footer
          reads as a screen with no way out of it, where a greyed-out button
          says there is one and what it is waiting for. */}
      {stage.kind === 'pick' ? (
        <PrimaryButton onClick={onContinue} disabled={!stage.provider}>
          Let&apos;s find it →
        </PrimaryButton>
      ) : stage.kind === 'connected' ? (
        <PrimaryButton onClick={onContinue}>Ask the agent →</PrimaryButton>
      ) : stage.kind === 'first-question' ? (
        <>
          {!stage.answered && (
            <span className="mr-auto flex items-center gap-1.5 text-[11px] text-tertiary">
              <FontAwesomeIcon icon={faSpinner} spin className="h-2.5 w-2.5" />
              {stage.asked ? 'The agent is answering…' : 'Waiting for your first question…'}
            </span>
          )}
          {!stage.asked && <SecondaryButton onClick={onBack}>Back</SecondaryButton>}
          {stage.answered && <PrimaryButton onClick={onContinue}>Finish setup →</PrimaryButton>}
        </>
      ) : stage.kind === 'finished' ? (
        <PrimaryButton onClick={onFinish}>Start exploring →</PrimaryButton>
      ) : (
        <>
          {setupStep > 0 && (
            <button
              type="button"
              onClick={onStartOver}
              disabled={submitting || advancing}
              className="mr-auto flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] text-tertiary transition-colors hover:text-main disabled:opacity-50"
            >
              <RotateCcw className="h-3 w-3" strokeWidth={1.8} />
              Start over
            </button>
          )}
          <SecondaryButton onClick={onBack} disabled={submitting || advancing}>
            Back
          </SecondaryButton>
          {setupStep < setupTotal - 1 ? (
            <PrimaryButton onClick={onAdvance} disabled={advancing}>
              {advancing ? '✓ Step complete' : 'I added it →'}
            </PrimaryButton>
          ) : (
            <PrimaryButton onClick={onSubmit} disabled={submitting || !canSubmit}>
              {submitting ? 'Connecting…' : 'Connect'}
            </PrimaryButton>
          )}
        </>
      )}
    </div>
  )
}

function PrimaryButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'h-8 rounded-md px-3 text-[12.5px] font-medium transition-colors',
        disabled
          ? 'cursor-not-allowed bg-zGray-800 text-tertiary'
          : 'bg-zViolet-500 text-white hover:bg-zViolet-400',
      )}
    >
      {children}
    </button>
  )
}

function SecondaryButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-8 rounded-md px-3 text-[12.5px] text-secondary transition-colors hover:bg-zGray-800 hover:text-main disabled:opacity-50"
    >
      {children}
    </button>
  )
}

export function PanelFooter({
  stage,
  setStage,
  setupStep,
  setupTotal,
  advancing,
  submitting,
  canSubmit,
  persistStep,
  beginSetup,
  advanceSetup,
  clearInputs,
  submit,
  onOpenAgentPage,
  onDone,
}: {
  stage: Stage
  setStage: Dispatch<SetStateAction<Stage>>
  setupStep: number
  setupTotal: number
  advancing: boolean
  submitting: boolean
  canSubmit: boolean
  persistStep: (provider: FirstRunProvider, purpose: Purpose, step: number) => void
  beginSetup: (provider: FirstRunProvider, purpose: Purpose) => void
  advanceSetup: () => void
  clearInputs: () => void
  submit: () => Promise<void>
  onOpenAgentPage: () => void
  onDone: () => void
}) {
  return (
    <Footer
      stage={stage}
      setupStep={setupStep}
      setupTotal={setupTotal}
      advancing={advancing}
      submitting={submitting}
      canSubmit={canSubmit}
      onBack={() => {
        if (stage.kind === 'first-question') {
          // Back to the wiring recap — worth a re-read before finishing.
          setStage({ kind: 'connected', provider: stage.provider })

          return
        }
        if (stage.kind !== 'setup') return
        if (setupStep > 0) {
          persistStep(stage.provider, stage.purpose, setupStep - 1)

          return
        }
        setStage({ kind: 'pick', provider: stage.provider })
      }}
      onContinue={() => {
        if (stage.kind === 'pick' && stage.provider) {
          track('agent_first_run_setup_started', { provider: stage.provider })
          beginSetup(stage.provider, 'operational')
        }
        if (stage.kind === 'connected')
          setStage({
            kind: 'first-question',
            provider: stage.provider,
            ...FRESH_FIRST_QUESTION,
          })
        if (stage.kind === 'first-question')
          setStage({ kind: 'finished', provider: stage.provider })
      }}
      onAdvance={advanceSetup}
      onSubmit={() => void submit()}
      onStartOver={() => {
        if (stage.kind !== 'setup') return
        clearInputs()
        persistStep(stage.provider, stage.purpose, 0)
      }}
      onFinish={() => {
        setStage({ kind: 'pick', provider: null })
        onOpenAgentPage()
        onDone()
      }}
    />
  )
}
