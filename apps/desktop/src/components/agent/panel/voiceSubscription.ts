import { parseAtlasError } from '../../../api/errors'
import { openInApp } from '../../../app/workspace/openInApp'
import { t } from '../../../i18n'
import { toast } from '../../ui/toast'

/**
 * Teams the backend has refused voice input for want of a subscription, as this
 * app last saw: a take for one of them would only be refused, so it does not
 * start. Billing's read of the team's plan clears it once the team subscribes.
 */
const unsubscribed = new Set<string>()

export function needsVoiceSubscription(teamId: string): boolean {
  return unsubscribed.has(teamId)
}

/** The backend would refuse the team's recordings: it has no subscription. */
export function markVoiceUnsubscribed(teamId: string) {
  unsubscribed.add(teamId)
}

/** The team subscribed, or its deployment has no billing: it may record again. */
export function markVoiceSubscribed(teamId: string) {
  unsubscribed.delete(teamId)
}

/** The backend refused a recording because the team has no subscription. */
export function isSubscriptionRequired(err: unknown): boolean {
  return parseAtlasError(err).code === 'subscription_required'
}

/** Says voice input needs a subscription, with Upgrade opening the team's Billing settings. */
export function voiceSubscriptionToast(teamId: string) {
  toast.error(
    t('Voice input needs a subscription'),
    t('Voice input is included with a Nuphos subscription.'),
    {
      action: {
        label: t('Upgrade'),
        onClick: () => openInApp(`/teams/${encodeURIComponent(teamId)}/settings/billing`),
      },
    },
  )
}
