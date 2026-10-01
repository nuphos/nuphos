// The first-run connect panel.
//
// It is docked rather than modal because every step of it happens somewhere
// else. The user is being asked to open their own cloud console and create
// things there, so the instructions have to survive them leaving: a modal
// blocks the app it is sitting in and vanishes the moment they need both hands.
// Docked, it stays on screen beside the composer, which means a newcomer stuck
// on "create the identity provider" can type the question and get an answer
// instead of a dead end.
//
// The setup is a focused quest: one finite objective at a time, visible progress,
// and a short acknowledgement before the next one arrives. That is gamification
// as a feedback loop, not game styling — no points, badges, or invented claims
// that Nuphos verified an action in another console. The step *text* still comes
// from the bind dialog's components: issuer, audience, and the subject condition
// that pins a role to one team are security-critical, and a second copy is a
// second thing to go stale.

import clsx from 'clsx'
import { X } from 'lucide-react'

import { track } from '../../lib/analytics'
import { CloudCliSetupChoice } from '../bind-account/cli-setup'
import { useCloudCliCheck } from '../bind-account/use-cloud-cli-check'

import { PanelFooter } from './first-run/buttons'
import { FinishedStage } from './first-run/finished'
import { FirstQuestion } from './first-run/FirstQuestion'
import { JourneyStrip } from './first-run/journey'
import { ConnectedInfo, FirstWinIntro } from './first-run/previews'
import { PANEL_WIDTH, stageTitle } from './first-run/progress'
import { SetupChecklist } from './first-run/SetupChecklist'
import { useFirstRunPanelActions } from './first-run/use-panel-actions'
import { useFirstRunPanelState } from './first-run/use-panel-state'

export function FirstRunPanel({
  open,
  teamId,
  onClose,
  onOpenAgentPage,
  onOpenAgentChat,
  onBound,
  onDone,
}: {
  open: boolean
  teamId: string
  onClose: () => void
  /** Navigates the current tab to the Agent page — the final screen links to
   *  it so "head to the Agent page" is a click, not a scavenger hunt. */
  onOpenAgentPage: () => void
  onOpenAgentChat: (prompt: string) => void
  /** A cloud was just bound. The shell's own "is this team still unconnected?"
   *  answer comes from the team's account set, which nothing else reloads —
   *  leaving "Walk me through it" offering a walkthrough of work already done. */
  onBound: () => void
  /** The guide is finished — close the panel. The first question travels by
   *  hand: the final screen shows it with a copy button, and the user pastes
   *  it into the chat themselves. */
  onDone: () => void
}) {
  const {
    stage,
    setStage,
    setupStep,
    setSetupStep,
    promptLang,
    pickPromptLang,
    advancing,
    setAdvancing,
    advanceTimerRef,
    contentScrollRef,
    submitting,
    setSubmitting,
    roleArn,
    setRoleArn,
    saEmail,
    setSaEmail,
    projectId,
    setProjectId,
    azureLabel,
    setAzureLabel,
    azureTenantId,
    setAzureTenantId,
    azureClientId,
    setAzureClientId,
    azureSubscriptionId,
    setAzureSubscriptionId,
    azureOidc,
    gcpWif,
    clearInputs,
    beginSetup,
  } = useFirstRunPanelState({ open, teamId })

  const cliCheck = useCloudCliCheck(
    open && stage.kind === 'setup',
    stage.kind === 'setup' ? stage.provider : null,
    teamId,
  )

  const { close, persistStep, setupTotal, advanceSetup, canSubmit, submit } =
    useFirstRunPanelActions({
      stage,
      setStage,
      advancing,
      setAdvancing,
      advanceTimerRef,
      setupStep,
      setSetupStep,
      teamId,
      onClose,
      onBound,
      clearInputs,
      roleArn,
      saEmail,
      projectId,
      azureLabel,
      azureTenantId,
      azureClientId,
      azureSubscriptionId,
      setSubmitting,
    })

  return (
    <aside
      style={{ width: open ? PANEL_WIDTH : 0 }}
      className={clsx(
        // Same surface as the agent panel it sits in place of, so the dock reads
        // as one slot with two possible occupants.
        'flex-shrink-0 sidebar-surface relative overflow-hidden',
        'transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
      )}
    >
      {/* Content lays out at the panel's final width from the first frame; the
          aside only clips it. Without this the text re-wraps at every
          intermediate width while the panel opens. */}
      <div style={{ width: PANEL_WIDTH }} className="flex h-full flex-col">
        {/* Height matches the agent panel's header and the content toolbar, so
          swapping between the two doesn't shift the first line of the page. */}
        <div className="h-[42px] flex-shrink-0 flex items-center gap-2 px-3">
          <div className="flex-1 truncate text-[13.5px] font-semibold text-main">
            Your first task
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="flex h-6 w-6 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-zGray-800/60 hover:text-main"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>

        <JourneyStrip stage={stage} setupStep={setupStep} setupTotal={setupTotal} />

        <div ref={contentScrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 selectable">
          {/* Not on the setup steps: each of those has its own objective as a
              heading, and a stage title above it just repeats the chapter the
              journey strip is already showing, on every single step. */}
          {stage.kind === 'pick' || stage.kind === 'setup' ? null : (
            <h2 className="pt-3 text-[15px] font-semibold text-main">{stageTitle(stage)}</h2>
          )}
          {stage.kind === 'pick' && (
            <FirstWinIntro
              provider={stage.provider}
              active={open}
              onPick={(provider) => {
                track('agent_first_run_cloud_picked', { provider })
                setStage({ kind: 'pick', provider })
              }}
            />
          )}
          {stage.kind === 'connected' && <ConnectedInfo provider={stage.provider} />}
          {stage.kind === 'first-question' && (
            <FirstQuestion
              provider={stage.provider}
              active={open}
              asked={stage.asked}
              answered={stage.answered}
              lang={promptLang}
              onPickLang={pickPromptLang}
              onOpenAgentPage={onOpenAgentPage}
            />
          )}
          {stage.kind === 'finished' && <FinishedStage provider={stage.provider} />}
          {stage.kind === 'setup' &&
            (cliCheck.visible ? (
              <CloudCliSetupChoice
                provider={stage.provider}
                teamId={teamId}
                check={cliCheck}
                onOpenAgentChat={onOpenAgentChat}
                onStarted={close}
                firstRun
              />
            ) : (
              <SetupChecklist
                provider={stage.provider}
                purpose={stage.purpose}
                step={setupStep}
                teamId={teamId}
                roleArn={roleArn}
                onRoleArnChange={setRoleArn}
                saEmail={saEmail}
                onSaEmailChange={setSaEmail}
                projectId={projectId}
                onProjectIdChange={setProjectId}
                azureOidc={azureOidc}
                gcpWif={gcpWif}
                azureLabel={azureLabel}
                onAzureLabelChange={setAzureLabel}
                azureTenantId={azureTenantId}
                onAzureTenantIdChange={setAzureTenantId}
                azureClientId={azureClientId}
                onAzureClientIdChange={setAzureClientId}
                azureSubscriptionId={azureSubscriptionId}
                onAzureSubscriptionIdChange={setAzureSubscriptionId}
              />
            ))}
        </div>

        {!cliCheck.visible && (
          <PanelFooter
            stage={stage}
            setStage={setStage}
            setupStep={setupStep}
            setupTotal={setupTotal}
            advancing={advancing}
            submitting={submitting}
            canSubmit={canSubmit}
            persistStep={persistStep}
            beginSetup={beginSetup}
            advanceSetup={advanceSetup}
            clearInputs={clearInputs}
            submit={submit}
            onOpenAgentPage={onOpenAgentPage}
            onDone={onDone}
          />
        )}
      </div>
    </aside>
  )
}
