import { config } from '@/config'

const ZSEND_SEND_URL = 'https://api.zeabur.com/api/v1/zsend/emails'

export type SendEmailInput = {
  to: string
  subject: string
  html: string
  text: string
}

export function isEmailConfigured(): boolean {
  return Boolean(config.email.zsendApiKey && config.email.from)
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const { zsendApiKey, from } = config.email

  if (!zsendApiKey || !from) {
    throw new Error('Email delivery is not configured (ZSEND_API_KEY / NUPHOS_EMAIL_FROM)')
  }

  const res = await fetch(ZSEND_SEND_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${zsendApiKey}`,
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

    throw new Error(`ZSend send failed: HTTP ${String(res.status)}${detail}`)
  }
}
