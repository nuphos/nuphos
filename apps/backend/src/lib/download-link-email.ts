import { MongoServerError } from 'mongodb'

import { db } from '@/lib/db'
import { isEmailConfigured, sendEmail } from '@/lib/email'
import { AppError } from '@/lib/errors'

import type { Collection, ObjectId } from 'mongodb'

// The links live on the landing site, whose /api/desktop/download endpoint is
// a stable redirect to the current release — an email opened weeks later still
// downloads the latest build.
const SITE_URL = 'https://nuphos.ai'

const RESEND_COOLDOWN_MS = 60 * 1000

type DownloadEmailDoc = {
  _id?: ObjectId
  email: string
  createdAt: Date
  expiresAt: Date
}

const sends = (): Collection<DownloadEmailDoc> =>
  db().collection<DownloadEmailDoc>('download_link_emails')

export async function setupDownloadLinkEmailIndexes(): Promise<void> {
  await Promise.all([
    sends().createIndex({ email: 1 }, { unique: true, background: true }),
    sends().createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'download_link_emails_ttl' },
    ),
  ])
}

/**
 * Emails the desktop download links to a signed-in user — the landing page
 * requests this for visitors on devices that can't run the desktop app.
 * The address must come from the session, never from client input.
 */
export async function sendDownloadLinkEmail(email: string): Promise<void> {
  if (!isEmailConfigured()) {
    throw new AppError(
      503,
      'email_not_configured',
      'Email delivery is not available on this server',
    )
  }

  const now = new Date()
  // Atomic cooldown, same shape as email-otp: the filter only matches docs
  // older than the cooldown, so a fresh doc forces the upsert down the insert
  // path, which the unique email index rejects — concurrent requests can't
  // each trigger a send.
  const cutoff = new Date(now.getTime() - RESEND_COOLDOWN_MS)

  try {
    await sends().updateOne(
      { email, createdAt: { $lt: cutoff } },
      { $set: { createdAt: now, expiresAt: new Date(now.getTime() + RESEND_COOLDOWN_MS) } },
      { upsert: true },
    )
  } catch (err) {
    if (err instanceof MongoServerError && err.code === 11000) {
      throw new AppError(
        429,
        'download_email_cooldown',
        'A download link was sent recently — wait a minute before requesting another',
      )
    }
    throw err
  }

  try {
    await sendEmail({ to: email, ...buildDownloadLinkEmail() })
  } catch (err) {
    // Undo the cooldown so a delivery failure doesn't lock the user out of
    // retrying.
    await sends()
      .deleteOne({ email })
      .catch(() => {})
    console.error('download-link-email: failed to send', err)
    throw new AppError(
      502,
      'download_email_send_failed',
      'Failed to send the download link — try again',
    )
  }
}

export function buildDownloadLinkEmail(): { subject: string; text: string; html: string } {
  const downloadPageUrl = `${SITE_URL}/download`
  const macArm64Url = `${SITE_URL}/api/desktop/download?arch=arm64`
  const macX64Url = `${SITE_URL}/api/desktop/download?arch=x64`
  const windowsX64Url = `${SITE_URL}/api/desktop/download?platform=windows`

  const text = [
    'Thanks for your interest in Nuphos!',
    '',
    'Nuphos is a desktop app. Open this link on your Mac or Windows computer',
    'and we’ll pick the right build for you:',
    '',
    `  ${downloadPageUrl}`,
    '',
    'Or grab a specific build directly:',
    '',
    `  macOS (Apple Silicon): ${macArm64Url}`,
    `  macOS (Intel):         ${macX64Url}`,
    `  Windows (x64):         ${windowsX64Url}`,
    '',
    'You received this email because someone signed in to nuphos.ai and asked',
    'for a download link. If that wasn’t you, you can safely ignore it.',
  ].join('\n')

  // Same card layout, palette, and font stack as the OTP sign-in email, so the
  // two read as one product.
  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:32px 16px;background:#f6f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a1e">
  <div style="max-width:420px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e6e6ea">
    <div style="font-size:16px;font-weight:600;margin-bottom:16px">Nuphos is ready to download</div>
    <div style="font-size:14px;color:#55555e;line-height:1.6;margin-bottom:24px">
      Nuphos is a desktop app. Open this email on your Mac or Windows computer
      and we&rsquo;ll pick the right build for you.
    </div>
    <div style="text-align:center;margin-bottom:24px">
      <a href="${downloadPageUrl}" style="display:inline-block;background:#7d36ec;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px">Download Nuphos</a>
    </div>
    <div style="font-size:13px;color:#55555e;margin-bottom:8px">Or grab a specific build:</div>
    <ul style="margin:0 0 24px;padding-left:20px;font-size:13px;line-height:1.9">
      <li><a href="${macArm64Url}" style="color:#7d36ec">macOS (Apple&nbsp;Silicon)</a></li>
      <li><a href="${macX64Url}" style="color:#7d36ec">macOS (Intel)</a></li>
      <li><a href="${windowsX64Url}" style="color:#7d36ec">Windows (x64)</a></li>
    </ul>
    <div style="font-size:12.5px;color:#8a8a94;line-height:1.6">
      You received this email because someone signed in to nuphos.ai and asked
      for a download link. If that wasn&rsquo;t you, you can safely ignore it.
    </div>
  </div>
</body>
</html>`

  return { subject: 'Your Nuphos download link', text, html }
}
