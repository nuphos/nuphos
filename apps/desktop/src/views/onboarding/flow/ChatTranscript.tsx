import { motion } from 'framer-motion'
import { useCallback, useState } from 'react'

import { IntegrationChips, SimulatedBindDemo, UserMsg } from './chat-bits'
import { deriveFirstName, EASE_OUT } from './shared'
import { StreamText } from './stream'
import { SecuritySection, SlackSection } from './transcript-sections'

import type { ChatStep, OnboardingProvider, OnboardingStagePlatform, SlackOutcome } from './shared'
import type { UserInfo } from '../../../types'

// The real onboarding conversation: create a workspace, walk through the
// security briefing, then demos connecting a cloud. Messages accumulate as `chatStep`
// advances; new ones animate in (staggered delays give the agent a natural
// "typing then replying" cadence).
export function ChatTranscript({
  user,
  reduce,
  stagePlatform,
  chatStep,
  workspaceName,
  onSecurityAck,
  selectedProvider,
  onPickProvider,
  onIntegrationNext,
  onBindingDone,
  slackBinding,
  slackOutcome,
  onConnectSlack,
  onSkipSlack,
  onEnterApp,
  hasJoinOptions,
  workspaceMode,
  joinedExisting,
}: {
  user: UserInfo
  reduce: boolean
  stagePlatform: OnboardingStagePlatform
  chatStep: ChatStep
  workspaceName: string
  onSecurityAck: () => void
  selectedProvider: OnboardingProvider | null
  onPickProvider: (provider: OnboardingProvider) => void
  onIntegrationNext: () => void
  onBindingDone: () => void
  slackBinding: boolean
  slackOutcome: SlackOutcome
  onConnectSlack: () => void
  onSkipSlack: () => void
  onEnterApp: () => void
  hasJoinOptions: boolean
  workspaceMode: 'pick' | 'create'
  joinedExisting: boolean
}) {
  const firstName = deriveFirstName(user)
  // Greeting captured at mount: if the user rejects every invitation the cards
  // vanish, but re-streaming a different greeting mid-conversation would read
  // as the agent rewriting history.
  const [greetWithJoinOptions] = useState(hasJoinOptions)
  // Everything after the workspace exists — briefing + connect accumulate.
  const briefed = chatStep !== 'workspace' && chatStep !== 'creating'
  // The briefing was acknowledged; the connect prompt is on screen (and stays
  // in the transcript through the Slack step).
  const integrating = chatStep === 'integration' || chatStep === 'binding'

  // Where the transcript mounted (dev jumps land mid-flow). Content belonging
  // to steps BEFORE the mount point renders instantly — history shouldn't
  // re-type itself — while the current step streams in live.
  const [mountStep] = useState<ChatStep>(chatStep)
  const mountedPastWorkspace = mountStep !== 'workspace' && mountStep !== 'creating'
  const mountedPastSecurity =
    mountStep === 'integration' || mountStep === 'binding' || mountStep === 'slack'
  const mountedPastIntegration = mountStep === 'slack'

  // The bridge line below waits for the greeting to finish typing rather than
  // starting its own clock at mount — otherwise the two type over each other.
  const [greetingDone, setGreetingDone] = useState(mountedPastWorkspace)
  const markGreetingDone = useCallback(() => setGreetingDone(true), [])

  // Getting from "workspace made" to the claims: the confirmation streams (0),
  // then the line introducing the set (1), then the user is offered the way in
  // (2) — and only when they take it do the claims start (3). That last gate
  // is deliberate: the claims clear this exchange off the screen, so without it
  // the two lines the agent just said would vanish before they were read.
  const [secStage, setSecStage] = useState(mountedPastSecurity ? 3 : 0)
  const advanceSec1 = useCallback(() => setSecStage((s) => Math.max(s, 1)), [])
  const advanceSec2 = useCallback(() => setSecStage((s) => Math.max(s, 2)), [])
  const startClaims = useCallback(() => setSecStage(3), [])

  // After the briefing is acknowledged the connect prompt streams, and only
  // then do the provider chips appear.
  const [chipsReady, setChipsReady] = useState(false)
  const showChips = useCallback(() => setChipsReady(true), [])

  // Sequential reveal of the Slack pitch, same shape as the briefing: intro
  // line → benefit line → the alert-demo stage + connect buttons.
  const [slackStage, setSlackStage] = useState(0)
  const advanceSlack1 = useCallback(() => setSlackStage((s) => Math.max(s, 1)), [])
  const advanceSlack2 = useCallback(() => setSlackStage((s) => Math.max(s, 2)), [])
  const advanceSlack3 = useCallback(() => setSlackStage((s) => Math.max(s, 3)), [])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: EASE_OUT }}
      className="space-y-4"
    >
      {/* Getting the workspace made — cleared from the screen the moment the
          claims start, so each one is read on a clean page rather than under a
          transcript of setup the user is done with. */}
      {secStage < 3 && (
        <>
          <StreamText
            reduce={reduce}
            skip={mountedPastWorkspace}
            startDelay={300}
            onDone={markGreetingDone}
            segments={
              greetWithJoinOptions
                ? [
                    `Hi ${firstName || 'there'}! You have `,
                    { text: 'teams', className: 'text-zViolet-300' },
                    ' waiting for you — join the ones you want, or create your own workspace.',
                  ]
                : [
                    `Hi ${firstName || 'there'}! Let's set up your first `,
                    { text: 'workspace', className: 'text-zViolet-300' },
                    '.',
                  ]
            }
          />

          {/* Bridge line when the user leaves the pick screen for the create
          composer: the greeting above pitched the join list, so the agent
          acknowledges the switch instead of rewriting history. */}
          {greetWithJoinOptions && workspaceMode === 'create' && greetingDone && (
            <StreamText
              reduce={reduce}
              skip={mountedPastWorkspace}
              startDelay={200}
              segments={['Sure — give your new workspace a name below.']}
            />
          )}

          {chatStep !== 'workspace' && (
            <UserMsg>{joinedExisting ? `Join ${workspaceName}` : workspaceName}</UserMsg>
          )}

          {chatStep === 'creating' && (
            <div className="flex items-center gap-2 text-[13.5px]">
              <span className="codex-shimmer-text t-text-swap">Setting up your workspace…</span>
            </div>
          )}
        </>
      )}

      {briefed && chatStep !== 'slack' && (
        <SecuritySection
          reduce={reduce}
          mountedPastSecurity={mountedPastSecurity}
          joinedExisting={joinedExisting}
          workspaceName={workspaceName}
          secStage={secStage}
          advanceSec1={advanceSec1}
          advanceSec2={advanceSec2}
          startClaims={startClaims}
          integrating={integrating}
          onSecurityAck={onSecurityAck}
        />
      )}

      {integrating && (
        <>
          <UserMsg>Sounds good — let&apos;s connect.</UserMsg>
          <StreamText
            reduce={reduce}
            skip={mountedPastIntegration}
            startDelay={400}
            segments={[
              "Here's how connecting a cloud works — nothing real gets created here. Pick one to see it:",
            ]}
            onDone={showChips}
          />
          {chatStep === 'integration' && chipsReady && (
            <IntegrationChips reduce={reduce} onPick={onPickProvider} onNext={onIntegrationNext} />
          )}
        </>
      )}

      {chatStep === 'binding' && selectedProvider && (
        <SimulatedBindDemo
          provider={selectedProvider}
          reduce={reduce}
          skip={mountedPastIntegration}
          onDone={onBindingDone}
        />
      )}

      {chatStep === 'slack' && (
        <SlackSection
          reduce={reduce}
          stagePlatform={stagePlatform}
          slackStage={slackStage}
          advanceSlack1={advanceSlack1}
          advanceSlack2={advanceSlack2}
          advanceSlack3={advanceSlack3}
          slackBinding={slackBinding}
          slackOutcome={slackOutcome}
          onConnectSlack={onConnectSlack}
          onSkipSlack={onSkipSlack}
          onEnterApp={onEnterApp}
        />
      )}
    </motion.div>
  )
}
