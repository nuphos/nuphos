import { ArrowRight } from 'lucide-react'
import { useCallback, useState } from 'react'

import { Button } from '../../../components/ui/button'

import { ActionDemo, MemoryDemo } from './action-memory'
import { ApprovalGate } from './ApprovalGate'
import { Reveal } from './chat-bits'
import { ClaimScreenBody } from './ClaimScreenBody'
import { ExperienceDemo } from './ExperienceDemo'
import { VALUE_PROP_POINTS } from './shared'
import { StreamText } from './stream'
import { TAME_CASCADE, TameSummary } from './tame-and-cards'
import {
  VALUE_PROP_AGENT_LINES,
  VALUE_PROP_META,
  VALUE_PROP_REPLIES,
  VALUE_PROP_REPLY_ANSWERS,
} from './value-prop-data'

import type { ApprovalDecision } from './value-prop-data'
import type { ReactNode } from 'react'

export function ValuePropsBriefing({
  reduce,
  skipReveal,
  acked,
  onAck,
  ackLabel,
}: {
  reduce: boolean
  skipReveal: boolean
  acked: boolean
  /** Leave the set — only offered from the fourth claim's screen. */
  onAck: () => void
  ackLabel: string
}) {
  // A dev jump lands on the last claim with everything already settled; a
  // real run starts at the first and steps forward one screen per canned
  // reply (back is also available, to revisit an earlier claim).
  const [activeIndex, setActiveIndex] = useState(skipReveal ? VALUE_PROP_META.length - 1 : 0)
  // The staggered cascade (this screen's agent line typing, then the card's
  // own reveal) is an entrance: it plays the first time the user arrives at a
  // claim, because that line is genuinely being said to them. Revisiting one
  // — Back, or forward to something already seen — swaps content instead of
  // re-performing it. Claims are marked seen on the way OUT, so the one
  // currently on screen is always the one still allowed to animate.
  const [seenClaims, setSeenClaims] = useState<Set<number>>(() => new Set())
  // The four are read one at a time; this is where they are put back together,
  // on a page of their own, before anything is asked for.
  const [atSummary, setAtSummary] = useState(skipReveal)
  const showSummary = useCallback(() => setAtSummary(true), [])
  const [summaryLineDone, setSummaryLineDone] = useState(skipReveal)
  const markSummaryLineDone = useCallback(() => setSummaryLineDone(true), [])
  const markSeen = useCallback(
    (index: number) => setSeenClaims((prev) => (prev.has(index) ? prev : new Set(prev).add(index))),
    [],
  )
  const go = useCallback(
    (delta: number) => {
      markSeen(activeIndex)
      setActiveIndex(Math.min(Math.max(activeIndex + delta, 0), VALUE_PROP_META.length - 1))
    },
    [activeIndex, markSeen],
  )
  const goNext = useCallback(() => go(1), [go])

  const skip = skipReveal || seenClaims.has(activeIndex)
  // Gates each claim's card on that claim's own line finishing. This used to be
  // one sticky boolean, so once the first line landed it stayed true and every
  // later claim rendered its card at the same moment its line started typing —
  // the reason only the first claim read in order.
  const [linesDone, setLinesDone] = useState<Set<number>>(
    () => new Set(skipReveal ? [0, 1, 2, 3] : []),
  )
  const markLineDone = useCallback(
    (index: number) => setLinesDone((prev) => (prev.has(index) ? prev : new Set(prev).add(index))),
    [],
  )
  const handleLineDone = useCallback(() => markLineDone(activeIndex), [markLineDone, activeIndex])
  const cardRevealed = linesDone.has(activeIndex)
  const isLastClaim = activeIndex === VALUE_PROP_META.length - 1

  // Claim 1 (Trust): the user's own approve/deny call, not a timer. Lifted up
  // here (rather than owned by ApprovalGate) so it survives the card
  // unmounting — cards are keyed on `activeIndex`, so going Back to Trust and
  // forward again must show the decision already made, not a reset gate.
  const [approvalDecision, setApprovalDecision] = useState<ApprovalDecision | null>(null)
  const handleApprovalDecision = useCallback(
    (decision: ApprovalDecision) => setApprovalDecision(decision),
    [],
  )

  // Claims 2-4: each demo below reports its own one-shot "first cycle done",
  // tracked by index here for the same reason — so revisiting a claim shows
  // its reply immediately instead of waiting on the (looping) demo again. A
  // dev jump lands past this whole step with every claim already resolved.
  const [passedClaims, setPassedClaims] = useState<Set<number>>(
    () => new Set(skipReveal ? [1, 2, 3] : []),
  )
  const markPassed = useCallback(
    (index: number) =>
      setPassedClaims((prev) => (prev.has(index) ? prev : new Set(prev).add(index))),
    [],
  )
  const markActionPassed = useCallback(() => markPassed(1), [markPassed])
  const markMemoryPassed = useCallback(() => markPassed(2), [markPassed])
  const markExperiencePassed = useCallback(() => markPassed(3), [markPassed])

  // Whether Trust's panel has played far enough to be asking for something.
  // Until then there is nothing to approve, so nothing is offered.
  const [requestReady, setRequestReady] = useState(skipReveal)
  const handleReachedRequest = useCallback(() => setRequestReady(true), [])

  // Claims 2-3 end the same way Trust does: the user sends the offered reply,
  // the agent answers it here, and only then is the way on offered. Keyed by
  // claim so a revisit shows the exchange already had rather than replaying it.
  const [repliedClaims, setRepliedClaims] = useState<Set<number>>(() => new Set())
  const [answeredClaims, setAnsweredClaims] = useState<Set<number>>(() => new Set())
  const sendReply = useCallback(
    (index: number) =>
      setRepliedClaims((prev) => (prev.has(index) ? prev : new Set(prev).add(index))),
    [],
  )
  const markAnswered = useCallback(
    (index: number) =>
      setAnsweredClaims((prev) => (prev.has(index) ? prev : new Set(prev).add(index))),
    [],
  )

  // Trust's answer to the user's call — streamed after it, so the guarantees
  // arrive as a response to something the user did rather than as a list they
  // read beforehand.
  const [trustAnswerDone, setTrustAnswerDone] = useState(skipReveal)
  const handleTrustAnswerDone = useCallback(() => setTrustAnswerDone(true), [])

  // Whether THIS screen's reply/exit control may show yet: Trust waits for
  // the user's decision AND the agent's answer to it, the other three for
  // their demo's first full pass.
  const claimPassed =
    activeIndex === 0 ? approvalDecision !== null && trustAnswerDone : passedClaims.has(activeIndex)
  const reply = VALUE_PROP_REPLIES[activeIndex]
  const replyAnswer = VALUE_PROP_REPLY_ANSWERS[activeIndex]
  const points = VALUE_PROP_POINTS[activeIndex]
  const replied = repliedClaims.has(activeIndex)
  const answered = answeredClaims.has(activeIndex)
  // Stable per screen: an inline arrow here changes identity every render, and
  // StreamText's effect depends on it — the answer restarted its type-out in a
  // loop, never settling.
  const handleAnswerDone = useCallback(() => markAnswered(activeIndex), [markAnswered, activeIndex])

  let demo: ReactNode

  switch (activeIndex) {
    case 0:
      demo = (
        <ApprovalGate
          decision={approvalDecision}
          reduce={reduce}
          settled={skip}
          onReachedRequest={handleReachedRequest}
        />
      )
      break
    case 1:
      demo = (
        <ActionDemo reduce={reduce} startDelay={skip ? 0 : 900} onFirstPass={markActionPassed} />
      )
      break
    case 2:
      demo = (
        <MemoryDemo reduce={reduce} startDelay={skip ? 0 : 900} onFirstPass={markMemoryPassed} />
      )
      break
    default:
      demo = (
        <ExperienceDemo
          reduce={reduce}
          startDelay={skip ? 0 : 900}
          onFirstPass={markExperiencePassed}
        />
      )
  }

  return (
    // Each screen IS one exchange: the reply that brought us here (absent on
    // screen 1), the agent's line, the claim card, then either the next
    // canned reply or (on the last claim) the exit button. `key={activeIndex}`
    // on the streamed pieces forces a fresh mount per screen so a revisit
    // never resumes a stale typing/count state from whichever claim was
    // shown before.
    <div className="space-y-3">
      {atSummary ? (
        <>
          <StreamText
            key="summary-line"
            reduce={reduce}
            skip={skipReveal}
            startDelay={200}
            segments={[
              'Put together, that is ',
              { text: 'TAME', className: 'font-medium text-main' },
              ' — what it takes to point an agent at production and sleep at night.',
            ]}
            onDone={markSummaryLineDone}
          />
          {summaryLineDone && <TameSummary reduce={reduce} skip={skipReveal} />}
          {summaryLineDone && !acked && (
            <Reveal reduce={reduce} skip={skipReveal} delay={TAME_CASCADE}>
              <Button onClick={onAck} className="group titlebar-no-drag">
                <span>{ackLabel}</span>
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
              </Button>
            </Reveal>
          )}
        </>
      ) : (
        <>
          <StreamText
            key={`line-${String(activeIndex)}`}
            reduce={reduce}
            skip={skip}
            startDelay={activeIndex === 0 ? 200 : 300}
            segments={VALUE_PROP_AGENT_LINES[activeIndex]}
            onDone={handleLineDone}
          />

          {cardRevealed && (
            <ClaimScreenBody
              activeIndex={activeIndex}
              reduce={reduce}
              skip={skip}
              skipReveal={skipReveal}
              demo={demo}
              acked={acked}
              approvalDecision={approvalDecision}
              requestReady={requestReady}
              trustAnswerDone={trustAnswerDone}
              onTrustAnswerDone={handleTrustAnswerDone}
              onApprovalDecision={handleApprovalDecision}
              points={points}
              goNext={goNext}
              claimPassed={claimPassed}
              reply={reply}
              replied={replied}
              replyAnswer={replyAnswer}
              answered={answered}
              onAnswerDone={handleAnswerDone}
              onSendReply={() => sendReply(activeIndex)}
              isLastClaim={isLastClaim}
              showSummary={showSummary}
            />
          )}
        </>
      )}
    </div>
  )
}
