import { config } from '@/config'

const PROVIDERS = {
  zsend: {
    name: 'ZSend',
    url: 'https://api.zeabur.com/api/v1/zsend/emails',
    keyVar: 'ZSEND_API_KEY',
  },
  resend: { name: 'Resend', url: 'https://api.resend.com/emails', keyVar: 'RESEND_API_KEY' },
} as const

export type SendEmailInput = {
  to: string
  subject: string
  html: string
  text: string
}

function providerApiKey(): string | undefined {
  return config.email.provider === 'resend' ? config.email.resendApiKey : config.email.zsendApiKey
}

export function isEmailConfigured(): boolean {
  return Boolean(providerApiKey() && config.email.from)
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const provider = PROVIDERS[config.email.provider]
  const apiKey = providerApiKey()
  const { from } = config.email

  if (!apiKey || !from) {
    throw new Error(`Email delivery is not configured (${provider.keyVar} / NUPHOS_EMAIL_FROM)`)
  }

  const res = await fetch(provider.url, {
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

    throw new Error(`${provider.name} send failed: HTTP ${String(res.status)}${detail}`)
  }
}
