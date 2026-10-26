import { escapeHtml, isEmailConfigured, sendEmail } from '@/lib/email'
import { userSessions } from '@/lib/identity/sessions'
import { logEvent } from '@/lib/observability'
import { describeSignInSource } from '@/lib/request-origin'

import type { NuphosUser } from '@/lib/identity/types'
import type { SignInSource } from '@/lib/request-origin'

/**
 * Whether a sign-in about to start should be reported to its user. Checked
 * against the account's other live sessions, before the new one exists:
 *
 *   - familiar: another session has the same IP, or the same app in the same
 *     country — no email;
 *   - no other live session (a brand-new account, or every earlier sign-in
 *     ended): nothing to compare with — no email;
 *   - otherwise it is new — email.
 */
export async function isNewSignIn(userId: string, source: SignInSource): Promise<boolean> {
  const others = await userSessions()
    .find({ userId, expiresAt: { $gt: new Date() } })
    .limit(200)
    .toArray()

  if (others.length === 0) return false

  return !others.some(
    (s) =>
      (source.ip !== undefined && s.ip === source.ip) ||
      (source.client !== undefined &&
        s.client === source.client &&
        source.country !== undefined &&
        s.country === source.country),
  )
}

/** Best effort: a failed alert is logged, never a failed sign-in. */
export async function sendNewSignInAlert(user: NuphosUser, source: SignInSource): Promise<void> {
  if (!isEmailConfigured()) return
  const { device, place } = describeSignInSource(source)
  const when = `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`
  const rows: [string, string][] = [
    ['Time', when],
    ['Device', device],
    ['Location', place],
    ['IP address', source.ip ?? 'Unknown'],
  ]

  try {
    await sendEmail({
      to: user.email,
      subject: 'New sign-in to your Nuphos account',
      html: alertHtml(rows),
      text: [
        'Your Nuphos account was just signed in to from a device or place it has not used recently.',
        '',
        ...rows.map(([k, v]) => `${k}: ${v}`),
        '',
        NOT_YOU,
      ].join('\n'),
    })
  } catch (err) {
    logEvent('warn', 'auth.sign_in_alert.send_failed', {
      user_id: user.id,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

const NOT_YOU =
  "Not you? Open Nuphos, go to Settings → Account → Signed-in devices and sign that device out, then reset your password from the sign-in screen. If this was you, there's nothing to do."

function alertHtml(rows: [string, string][]): string {
  const table = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#8a8a94">${escapeHtml(k)}</td><td style="padding:4px 0">${escapeHtml(v)}</td></tr>`,
    )
    .join('')

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:32px 16px;background:#f6f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a1e">
  <div style="max-width:420px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e6e6ea">
    <div style="font-size:16px;font-weight:600;margin-bottom:16px">New sign-in to Nuphos</div>
    <div style="font-size:14px;color:#55555e;line-height:1.6;margin-bottom:16px">
      Your account was just signed in to from a device or place it has not used recently.
    </div>
    <table style="font-size:14px;line-height:1.5;border-collapse:collapse">${table}</table>
    <div style="font-size:12.5px;color:#55555e;line-height:1.6;margin-top:24px">${escapeHtml(NOT_YOU)}</div>
  </div>
</body>
</html>`
}
