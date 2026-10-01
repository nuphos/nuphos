import { Button as BaseButton } from '@base-ui/react/button'
import { ArrowRight } from 'lucide-react'

import { CloudLogo } from '../../../components/CloudLogo'
import { Button } from '../../../components/ui/button'

import { Reveal, UserMsg } from './chat-bits'
import { SlackAlertStage } from './SlackAlertStage'
import { FollowGrowth, StreamText } from './stream'
import { ValuePropsBriefing } from './ValuePropsBriefing'

import type { OnboardingStagePlatform, SlackOutcome } from './shared'

export function SecuritySection({
  reduce,
  mountedPastSecurity,
  joinedExisting,
  workspaceName,
  secStage,
  advanceSec1,
  advanceSec2,
  startClaims,
  integrating,
  onSecurityAck,
}: {
  reduce: boolean
  mountedPastSecurity: boolean
  joinedExisting: boolean
  workspaceName: string
  secStage: number
  advanceSec1: () => void
  advanceSec2: () => void
  startClaims: () => void
  integrating: boolean
  onSecurityAck: () => void
}) {
  return (
    <>
      {secStage < 3 && (
        <>
          <StreamText
            reduce={reduce}
            skip={mountedPastSecurity}
            startDelay={250}
            segments={
              joinedExisting
                ? [
                    "You're in — welcome to ",
                    { text: workspaceName, className: 'font-medium' },
                    '.',
                  ]
                : [{ text: workspaceName, className: 'font-medium' }, ' setup complete.']
            }
            onDone={advanceSec1}
          />
          {secStage >= 1 && (
            <StreamText
              reduce={reduce}
              skip={mountedPastSecurity}
              startDelay={400}
              segments={
                joinedExisting
                  ? [
                      'Before you dive in — here are the ',
                      { text: 'four things', className: 'font-medium' },
                      ' Nuphos gives your team.',
                    ]
                  : [
                      'Before we go further — here are the ',
                      { text: 'four things', className: 'font-medium' },
                      ' Nuphos gives you, starting with the one that governs everything else.',
                    ]
              }
              onDone={advanceSec2}
            />
          )}
          {secStage >= 2 && (
            <Reveal reduce={reduce} skip={mountedPastSecurity}>
              {/* An offer from the agent, not something the user said — so it
              takes the shape the other offers in this flow take (the
              approval buttons), and names what it leads to rather than
              making the user find out by pressing it. */}
              <button
                type="button"
                onClick={startClaims}
                className="titlebar-no-drag inline-flex h-8 items-center gap-1.5 rounded-md bg-zViolet-500 px-3 text-[12px] font-medium text-white transition-colors hover:bg-zViolet-600 outline-none focus-visible:ring-2 focus-visible:ring-zViolet-400/60"
              >
                Show me the four things
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.4} />
              </button>
            </Reveal>
          )}
        </>
      )}
      {secStage >= 3 && (
        <ValuePropsBriefing
          reduce={reduce}
          skipReveal={mountedPastSecurity}
          acked={integrating}
          onAck={onSecurityAck}
          ackLabel={joinedExisting ? 'Got it — take me in' : "Got it — what's next?"}
        />
      )}
    </>
  )
}

export function SlackSection({
  reduce,
  stagePlatform,
  slackStage,
  advanceSlack1,
  advanceSlack2,
  advanceSlack3,
  slackBinding,
  slackOutcome,
  onConnectSlack,
  onSkipSlack,
  onEnterApp,
}: {
  reduce: boolean
  stagePlatform: OnboardingStagePlatform
  slackStage: number
  advanceSlack1: () => void
  advanceSlack2: () => void
  advanceSlack3: () => void
  slackBinding: boolean
  slackOutcome: SlackOutcome
  onConnectSlack: () => void
  onSkipSlack: () => void
  onEnterApp: () => void
}) {
  return (
    <>
      <StreamText
        reduce={reduce}
        startDelay={300}
        segments={[
          'One more way to work with me — from ',
          { text: 'Slack', className: 'font-medium' },
          ', without opening this app at all.',
        ]}
        onDone={advanceSlack1}
      />
      {slackStage >= 1 && (
        <StreamText
          reduce={reduce}
          startDelay={350}
          segments={[
            "@Nuphos in any channel to deploy, debug, or ask anything — same agent, same context as here. And when something looks wrong in your cloud, I'll come to you there before your users notice.",
          ]}
          onDone={advanceSlack2}
        />
      )}
      {slackStage >= 2 && (
        <>
          <Reveal reduce={reduce} delay={0.1}>
            <SlackAlertStage reduce={reduce} platform={stagePlatform} />
          </Reveal>
          {!slackBinding && slackOutcome === null && (
            <Reveal reduce={reduce} delay={0.7} className="flex flex-wrap gap-2 pt-1">
              {/* Styled to match the sidebar Slack promo's Connect button
                  (SidebarSlackPromo): Slack green, white slack tile. */}
              <BaseButton
                onClick={onConnectSlack}
                className="titlebar-no-drag inline-flex h-8 items-center justify-center gap-2 rounded-md bg-[#007A5A] px-3.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 outline-none focus-visible:ring-2 focus-visible:ring-[#007A5A]/60"
              >
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md bg-white">
                  <CloudLogo provider="slack" size={12} />
                </span>
                Connect to Slack
              </BaseButton>
              <BaseButton
                onClick={onSkipSlack}
                className="titlebar-no-drag inline-flex items-center rounded-xl px-3.5 py-2 text-[13px] text-tertiary transition-colors hover:text-secondary outline-none focus-visible:ring-2 focus-visible:ring-zViolet-400/50"
              >
                Skip
              </BaseButton>
            </Reveal>
          )}
        </>
      )}
      {slackOutcome !== null && (
        <FollowGrowth reduce={reduce} active>
          <UserMsg>{slackOutcome === 'connected' ? 'Connected.' : 'Maybe later.'}</UserMsg>
          <StreamText
            key={`outcome-${slackOutcome}`}
            reduce={reduce}
            startDelay={300}
            segments={
              slackOutcome === 'connected'
                ? [
                    "Done — I'll reach you there when it matters. That's everything; your workspace is ready when you are.",
                  ]
                : [
                    "No problem — you can connect Slack from settings whenever you want it. That's everything; your workspace is ready when you are.",
                  ]
            }
            onDone={advanceSlack3}
          />
          {slackStage >= 3 && (
            <Reveal reduce={reduce} delay={0.2}>
              <Button onClick={onEnterApp} className="group titlebar-no-drag">
                <span>Take me in</span>
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
              </Button>
            </Reveal>
          )}
        </FollowGrowth>
      )}

      {slackBinding && (
        <>
          <UserMsg>Help me connect Slack.</UserMsg>
          <StreamText
            reduce={reduce}
            startDelay={300}
            segments={['Please authorize Slack in the pop-up window.']}
          />
        </>
      )}
    </>
  )
}
