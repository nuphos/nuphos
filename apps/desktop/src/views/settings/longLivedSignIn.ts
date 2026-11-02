import { t } from '../../i18n/index.ts'

const DAY_MS = 86_400_000
/** A one-year token gets a month's notice; signing in again starts a new year. */
const RENEW_WITHIN_DAYS = 30

/** What the runtime row says about a sign-in that lapses on its own, and whether to offer renewing it. */
export function longLivedSignIn(expiresAt: string, now = Date.now()) {
  const at = Date.parse(expiresAt)
  const days = Math.ceil((at - now) / DAY_MS)
  const date = new Date(at).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

  if (days > RENEW_WITHIN_DAYS)
    return {
      note: t(
        'Signed in with a one-year token that never needs refreshing. It expires on {date}.',
        {
          date,
        },
      ),
      renew: false,
    }

  return {
    note:
      days > 1
        ? t(
            'Signed in with a one-year token that expires in {days} days. Sign in again to renew it.',
            {
              days,
            },
          )
        : days === 1
          ? t(
              'Signed in with a one-year token that expires within a day. Sign in again to renew it.',
            )
          : t('The one-year token this runtime signed in with has expired. Sign in again.'),
    renew: true,
  }
}
