export type ConnectAgentLink = {
  /** The agent's ACP address, `ws(s)://host[:port]/acp`. */
  url: string
  code: string
  /** Epoch milliseconds the code stops working, when the console said. */
  expiresAt?: number
}

const PAIRING_CODE = /^[A-Z2-7]{26}$/u
const WS_PROTOCOL: Record<string, string> = {
  'https:': 'wss:',
  'http:': 'ws:',
  'wss:': 'wss:',
  'ws:': 'ws:',
}

export function normalizeAgentUrl(value: string): string | null {
  let url: URL

  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  const protocol = WS_PROTOCOL[url.protocol]

  if (!protocol || !url.hostname || url.username || url.password) return null
  const path =
    url.pathname === '/' || url.pathname === '' ? '/acp' : url.pathname.replace(/\/$/u, '')

  return `${protocol}//${url.host}${path}`
}

/** Tolerates how people retype a code: lower case, spaces and dashes between groups. */
export function normalizePairingCode(value: string): string | null {
  const code = value.replace(/[\s-]/gu, '').toUpperCase()

  return PAIRING_CODE.test(code) ? code : null
}

export function isConnectAgentLink(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)

    return url.protocol === 'nuphos:' && url.hostname === 'connect-runtime'
  } catch {
    return false
  }
}

export function parseConnectAgentLink(rawUrl: string): ConnectAgentLink | null {
  if (!isConnectAgentLink(rawUrl)) return null
  const params = new URL(rawUrl).searchParams
  const url = normalizeAgentUrl(params.get('url') ?? '')
  const code = normalizePairingCode(params.get('code') ?? '')

  if (!url || !code) return null
  const exp = Number(params.get('exp'))

  return { url, code, ...(Number.isFinite(exp) && exp > 0 ? { expiresAt: exp * 1000 } : {}) }
}

export function agentHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
