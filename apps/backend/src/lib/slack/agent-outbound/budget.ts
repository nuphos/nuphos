const MAX_REJECTED_BEFORE_DELIVERY = 5
// Far above any rate a person would post at: this catches a loop, it does not
// arbitrate whether a message was worth sending.
const MAX_POSTS_PER_TURN = 5

type Rejection = { ok: false; error: string }

export type SlackPostAttempt = {
  commitAttempt: () => boolean
  rejectBeforeDelivery: (error: string) => Rejection
  countUncommittedThrow: () => void
}

export type SlackPostBudget = {
  overBudget: () => Rejection
  beginCall: () => Rejection | null
  newAttempt: () => SlackPostAttempt
}

export function createSlackPostBudget(hasTriggerNotification: boolean): SlackPostBudget {
  // An ordinary turn answers a person who is right there, so one outbound
  // message is the whole allowance. An on-call handling an alert speaks
  // more than once by nature — acknowledge, then follow up — so the only
  // ceiling there is a loop guard, far above any human posting rate. When
  // to speak, and whether a thing is worth saying, stay its judgment.
  const postCeiling = hasTriggerNotification ? MAX_POSTS_PER_TURN : 1
  let postAttempts = 0
  // Calls rejected before they reach Slack. Capped so a model repeating the
  // same invalid call cannot loop, without letting one correctable mistake
  // cost the incident its only notification.
  let rejectedBeforeDelivery = 0
  const overBudget = (): Rejection => ({
    ok: false,
    error: hasTriggerNotification
      ? 'This turn has already sent several Slack messages. Stop posting and finish the investigation instead.'
      : 'Slack posting is limited to one message per agent turn. Do not retry or send another message in this turn.',
  })

  return {
    overBudget,
    beginCall: () => {
      if (postAttempts >= postCeiling) return overBudget()
      // A call rejected below never reaches Slack — wrong destination, an
      // unlinked channel, a trigger changed mid-run. Spending the incident's
      // one opening post on a mistake the model can correct would leave the
      // firing with no notification at all, so the budget is spent only once
      // we commit to a delivery.
      if (rejectedBeforeDelivery >= MAX_REJECTED_BEFORE_DELIVERY) {
        return {
          ok: false,
          error:
            'Too many invalid Slack post attempts in this turn. Stop calling slack_post and report the problem instead.',
        }
      }

      return null
    },
    newAttempt: () => {
      let attemptSpent = false

      return {
        // The ceiling is re-checked here, not only at the top of post(): several
        // awaits sit in between, and the model can issue more than one tool call
        // in a single step. Check-and-increment with nothing awaited between them
        // is atomic on a single thread, so this is the authority on whether a
        // delivery may proceed; the earlier check is only a fast path.
        commitAttempt: () => {
          if (attemptSpent) return true
          if (postAttempts >= postCeiling) return false
          attemptSpent = true
          postAttempts += 1

          return true
        },
        // Refunding the delivery budget and counting the rejection happen
        // together, here, so a caller cannot get half of it right. Four rounds
        // of review found four variants of exactly that mistake: an explicit
        // return that counted nothing, a throw that counted nothing, and a
        // refund that forgot to re-open the rejection counter.
        rejectBeforeDelivery: (error: string): Rejection => {
          if (attemptSpent) {
            postAttempts -= 1
            attemptSpent = false
          }
          rejectedBeforeDelivery += 1

          return { ok: false, error }
        },
        // A throw before the attempt was committed is the same thing as an
        // explicit pre-delivery rejection: nothing reached Slack, and the
        // model can correct it. It has to be counted for the same reason —
        // resolving a channel or opening a DM calls Slack, so an uncapped
        // retry loop here is a loop against their API.
        countUncommittedThrow: () => {
          if (!attemptSpent) rejectedBeforeDelivery += 1
        },
      }
    },
  }
}
