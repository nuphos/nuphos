// Allowed-email-domain discovery: teams list corporate domains (e.g.
// "acme.com"); users signing in with a verified email on one of those domains
// are offered membership. Public mailbox providers are rejected — anyone can
// register an address there, so matching on them would let strangers join.
const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.co.jp',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'zoho.com',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'yandex.com',
  'yandex.ru',
  'mail.ru',
  'qq.com',
  'foxmail.com',
  '163.com',
  '126.com',
  'yeah.net',
  '139.com',
  '189.cn',
  'sina.com',
  'sina.cn',
  'sohu.com',
  'aliyun.com',
  'naver.com',
  'daum.net',
  'hanmail.net',
  'fastmail.com',
  'hey.com',
  'tutanota.com',
  'tuta.io',
  'duck.com',
])

// RFC 1035-ish hostname: dot-separated labels, at least one dot so bare TLDs
// like "com" can't be registered as a company domain.
const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/** Normalize a user-entered domain ("@Acme.com " → "acme.com"); null if not a valid domain. */
export function normalizeEmailDomain(input: string): string | null {
  const domain = input.trim().toLowerCase().replace(/^@/, '')

  return DOMAIN_RE.test(domain) ? domain : null
}

/** Extract the normalized domain from an email address; null if malformed. */
export function extractEmailDomain(email: string): string | null {
  const at = email.lastIndexOf('@')

  if (at < 0) return null

  return normalizeEmailDomain(email.slice(at + 1))
}

export function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAINS.has(domain)
}
