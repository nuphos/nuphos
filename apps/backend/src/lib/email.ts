import { config } from '@/config'

/** For values placed in an email's HTML. */
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  )
}

export type SendEmailInput = {
  to: string
  subject: string
  html: string
  text: string
}

export function isEmailConfigured(): boolean {
  return Boolean(config.email.resendApiKey && config.email.from)
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const { resendApiKey: apiKey, from } = config.email

  if (!apiKey || !from) {
    throw new Error('Email delivery is not configured (RESEND_API_KEY / NUPHOS_EMAIL_FROM)')
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const detail = body ? ` — ${body.slice(0, 200)}` : ''

    throw new Error(`Resend send failed: HTTP ${String(res.status)}${detail}`)
  }
}
