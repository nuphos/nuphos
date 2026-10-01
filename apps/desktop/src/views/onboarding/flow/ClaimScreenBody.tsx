import { AnimatePresence } from 'framer-motion'
import { ArrowRight, Check, X } from 'lucide-react'

import { CannedReplyButton, Reveal, UserMsg, ValuePropPoints } from './chat-bits'
import { pointsCascade } from './shared'
import { FollowGrowth, StreamText } from './stream'
import { ValuePropCard } from './tame-and-cards'
import { VALUE_PROP_META } from './value-prop-data'

import type { ValuePropPoint } from './shared'
import type { StreamSegment } from './stream'
import type { ApprovalDecision } from './value-prop-data'
import type { ReactNode } from 'react'

export function ClaimScreenBody({
  activeIndex,
  reduce,
  skip,
  skipReveal,
  demo,
  acked,
  approvalDecision,
  requestReady,
  trustAnswerDone,
  onTrustAnswerDone,
  onApprovalDecision,
  points,
  goNext,
  claimPassed,
  reply,
  replied,
  replyAnswer,
  answered,
  onAnswerDone,
  onSendReply,
  isLastClaim,
  showSummary,
}: {
  activeIndex: number
  reduce: boolean
  skip: boolean
  skipReveal: boolean
  demo: ReactNode
  acked: boolean
  approvalDecision: ApprovalDecision | null
  requestReady: boolean
  trustAnswerDone: boolean
  onTrustAnswerDone: () => void
  onApprovalDecision: (decision: ApprovalDecision) => void
  points: ValuePropPoint[]
  goNext: () => void
  claimPassed: boolean
  reply: string | null
  replied: boolean
  replyAnswer: StreamSegment[] | null
  answered: boolean
  onAnswerDone: () => void
  onSendReply: () => void
  isLastClaim: boolean
  showSummary: () => void
}) {
  const meta = VALUE_PROP_META[activeIndex]

  return (
    <>
      {/* AnimatePresence's own `initial` controls ONLY its first-ever
      render (framer-motion: `PresenceChild`'s effective initial is
      `!isInitialRender.current || initial`, so it's forced true —
      i.e. un-blocked — on every render after the first, no matter
      what we pass here). That first render is exactly a genuinely-new
      user seeing claim 1: hardcoding `initial={false}` there forced
      `presenceContext.initial = false`, which every descendant
      motion.div (the demo/heading Reveals) reads and uses to
      skip its own initial → animate step, popping the whole card in
      at once instead of playing the cascade. Conditioning it on
      `skipReveal` keeps that suppression for the one case that wants
      it (a dev jump mounted straight past this step, rendering
      static history) while letting a fresh first view animate
      normally. */}
      <AnimatePresence mode="wait" initial={!skipReveal}>
        <ValuePropCard
          key={activeIndex}
          index={activeIndex}
          icon={meta.icon}
          title={meta.title}
          body={meta.body}
          demo={demo}
          reduce={reduce}
          skip={skip}
          history={skipReveal}
        />
      </AnimatePresence>

      {/* The user's call, spoken — pressing a button IS their turn in the
      conversation, so it lands as their message before the agent
      answers it. */}
      {activeIndex === 0 && approvalDecision !== null && (
        <FollowGrowth reduce={reduce} active={!skip}>
          <UserMsg key={`decision-${approvalDecision}`}>
            {approvalDecision === 'approved' ? 'Approve' : 'Reject'}
          </UserMsg>
          <StreamText
            key={`answer-${approvalDecision}`}
            reduce={reduce}
            skip={skip}
            startDelay={300}
            segments={
              approvalDecision === 'approved'
                ? [
                    'Done — api-server restarted, and your call is in the audit log. That one action is the whole model:',
                  ]
                : [
                    "Nothing ran — and the refusal is in the audit log too, so there's a record either way. That one action is the whole model:",
                  ]
            }
            onDone={onTrustAnswerDone}
          />
          {trustAnswerDone && <ValuePropPoints points={points} reduce={reduce} skip={skip} />}
          {trustAnswerDone && (
            <Reveal reduce={reduce} skip={skip} delay={pointsCascade(points.length)}>
              <button
                type="button"
                onClick={goNext}
                className="titlebar-no-drag inline-flex h-8 items-center gap-1.5 rounded-md bg-zViolet-500 px-3 text-[12px] font-medium text-white transition-colors hover:bg-zViolet-600 outline-none focus-visible:ring-2 focus-visible:ring-zViolet-400/60"
              >
                Next — Action
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.4} />
              </button>
            </Reveal>
          )}
        </FollowGrowth>
      )}

      {/* The agent's ask, answered in the conversation rather than on the
      request panel — the same shape the real approval takes in the
      agent panel (PermissionGrantCard), so what the user practises
      here is what they'll do later. */}
      {activeIndex === 0 && !acked && approvalDecision === null && requestReady && (
        <Reveal reduce={reduce} skip={skip} delay={0}>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onApprovalDecision('approved')}
              aria-label="Approve restarting api-server"
              className="titlebar-no-drag inline-flex h-8 items-center gap-1.5 rounded-md bg-zViolet-500 px-3 text-[12px] font-medium text-white transition-colors hover:bg-zViolet-600 outline-none focus-visible:ring-2 focus-visible:ring-zViolet-400/60"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
              Approve &amp; apply
            </button>
            <button
              type="button"
              onClick={() => onApprovalDecision('denied')}
              aria-label="Reject restarting api-server"
              className="titlebar-no-drag inline-flex h-8 items-center gap-1.5 rounded-md bg-zGray-800 px-3 text-[12px] font-medium text-main transition-colors hover:bg-zGray-700 outline-none focus-visible:ring-2 focus-visible:ring-zGray-400/50"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.4} />
              Reject
            </button>
          </div>
        </Reveal>
      )}

      {/* Back (quiet — revisiting a claim, not the main path) and
      whatever moves the conversation on: a canned reply for claims
      1-3, the exit button on the 4th. Gated on `claimPassed` — the
      reply waits for THIS claim's demo to make its point (Trust: a
      real approve/deny; the rest: their first full loop), not a
      timer. Both freeze once the set is acknowledged — this screen
      then just sits as settled history while its demo keeps
      looping. */}
      {!acked && claimPassed && reply && !replied && (
        <Reveal reduce={reduce} skip={skip} delay={0.3}>
          <CannedReplyButton onClick={onSendReply}>{reply}</CannedReplyButton>
        </Reveal>
      )}

      {/* The exchange the reply starts, finished here rather than by
      swapping the screen out from under it. */}
      {!acked && replied && (
        <FollowGrowth reduce={reduce} active={!skip}>
          <UserMsg key={`sent-${String(activeIndex)}`}>{reply}</UserMsg>
          <StreamText
            key={`answer-${String(activeIndex)}`}
            reduce={reduce}
            skip={skip}
            startDelay={300}
            segments={replyAnswer ?? []}
            onDone={onAnswerDone}
          />
          {answered && (
            <>
              <ValuePropPoints points={points} reduce={reduce} skip={skip} />
              <Reveal reduce={reduce} skip={skip} delay={pointsCascade(points.length)}>
                {isLastClaim ? (
                  <button
                    type="button"
                    onClick={showSummary}
                    className="titlebar-no-drag inline-flex h-8 items-center gap-1.5 rounded-md bg-zViolet-500 px-3 text-[12px] font-medium text-white transition-colors hover:bg-zViolet-600 outline-none focus-visible:ring-2 focus-visible:ring-zViolet-400/60"
                  >
                    Next — all four together
                    <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.4} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={goNext}
                    className="titlebar-no-drag inline-flex h-8 items-center gap-1.5 rounded-md bg-zViolet-500 px-3 text-[12px] font-medium text-white transition-colors hover:bg-zViolet-600 outline-none focus-visible:ring-2 focus-visible:ring-zViolet-400/60"
                  >
                    Next — {VALUE_PROP_META[activeIndex + 1].title}
                    <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.4} />
                  </button>
                )}
              </Reveal>
            </>
          )}
        </FollowGrowth>
      )}
    </>
  )
}
