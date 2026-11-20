import { api } from '../../../api'
import { parseAtlasError } from '../../../api/errors'
import { openInApp } from '../../../app/workspace/openInApp'
import { t } from '../../../i18n'
import { toast } from '../../ui/toast'

import type { BoxUsage } from '../../../api/device-types'

/**
 * Teams whose recordings the backend would refuse for want of a subscription, as this
 * app last saw: a refusal, or a read of the team's plan. A take for one of them asks
 * the plan again before it starts, since a teammate may have subscribed since.
 */
const unsubscribed = new Set<string>()

/** The backend refused this team's recording earlier in this app session. */
export function needsVoiceSubscription(teamId: string): boolean {
  return unsubscribed.has(teamId)
}

/** The backend would refuse the team's recordings: it has no subscription. */
export function markVoiceUnsubscribed(teamId: string) {
  unsubscribed.add(teamId)
}

/** Records what the team's plan says about voice input; true when the backend would transcribe. */
export function rememberVoicePlan(
  teamId: string,
  plan: Pick<BoxUsage, 'billingUrl' | 'subscribed'>,
) {
  // The backend's own gate: a billing service, and no subscription of the team's.
  const allowed = plan.billingUrl === null || plan.subscribed

  if (allowed) unsubscribed.delete(teamId)
  else unsubscribed.add(teamId)

  return allowed
}

/** Reads the team's plan now; one that can't be read lets the take go, and the backend decides. */
export async function planAllowsVoice(teamId: string): Promise<boolean> {
  const plan = await api.boxUsage(teamId).catch(() => null)

  return plan ? rememberVoicePlan(teamId, plan) : true
}

/** The backend refused a recording because the team has no subscription. */
export function isSubscriptionRequired(err: unknown): boolean {
  return parseAtlasError(err).code === 'subscription_required'
}

/**
 * Says voice input needs a subscription. An administrator gets Subscribe, opening the
 * team's Billing settings; anyone else can't subscribe there, so they are told whom to ask.
 */
export function voiceSubscriptionToast(teamId: string, canSubscribe: boolean) {
  if (!canSubscribe) {
    toast.error(t('Voice input needs a subscription'), t('Ask a team admin to subscribe.'))

    return
  }
  toast.error(
    t('Voice input needs a subscription'),
    t("Your team doesn't have a subscription yet."),
    {
      action: {
        label: t('Subscribe'),
        onClick: () => openInApp(`/teams/${encodeURIComponent(teamId)}/settings/billing`),
      },
    },
  )
}
