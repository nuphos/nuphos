import { escapeHtml, isEmailConfigured, sendEmail } from '@/lib/email'
import { logEvent } from '@/lib/observability'

/** Best effort, like the sign-in alert: a failed email never fails the change. */
export async function notify(to: string, subject: string, line: string): Promise<void> {
  if (!isEmailConfigured()) return
  const notYou =
    "Not you? Open Nuphos, go to Settings → Account → Signed-in devices and sign out the devices you don't recognise, then reset your password from the sign-in screen."

  try {
    await sendEmail({
      to,
      subject,
      text: `${line}\n\n${notYou}`,
      html: `<p>${escapeHtml(line)}</p><p style="color:#55555e">${escapeHtml(notYou)}</p>`,
    })
  } catch (err) {
    logEvent('warn', 'auth.mfa.notify_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
