import { escapeHtml, isEmailConfigured, sendEmail } from '@/lib/email'
import { userSessions } from '@/lib/identity/sessions'
import { logEvent } from '@/lib/observability'
import { signInDevice, signInPlace } from '@/lib/request-origin'

import type { NuphosUser } from '@/lib/identity/types'
import type { SignInSource } from '@/lib/request-origin'

const NEW_ACCOUNT_MS = 60 * 60 * 1000

/**
 * Whether a sign-in about to start should be reported to its user. Only the
 * IP decides, checked against the account's other sessions (all from the last
 * 30 days, the longest a session lives) before the new one exists:
 *
 *   - no trusted IP (not behind Cloudflare), or an earlier session used this
 *     exact IP: no email;
 *   - the account was created within the hour and has no other session: its
 *     first sign-in, no email;
 *   - otherwise: email.
 *
 * City and country only describe the sign-in in the email.
 */
export async function isNewSignIn(user: NuphosUser, source: SignInSource): Promise<boolean> {
  const others = await userSessions()
    .find({ userId: user.id, expiresAt: { $gt: new Date() } })
    .limit(200)
    .toArray()

  // Without a trusted IP there is nothing to compare.
  if (source.ip === undefined || others.some((s) => s.ip === source.ip)) return false
  if (others.length === 0 && Date.now() - Date.parse(user.createdAt) < NEW_ACCOUNT_MS) return false

  return true
}

/** Best effort: a failed alert is logged, never a failed sign-in. */
export async function sendNewSignInAlert(user: NuphosUser, source: SignInSource): Promise<void> {
  if (!isEmailConfigured()) return
  const when = `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`
  // Time and IP are what the server saw; place and device are only hints.
  const rows: [string, string][] = [
    ['Time', when],
    ['IP address', source.ip ?? 'Unknown'],
    ['Approximate location', signInPlace(source) ?? 'Unknown'],
    ['Device', signInDevice(source)],
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
