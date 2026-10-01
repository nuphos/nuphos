export const BROWSER_HOME_URL = 'https://www.google.com'

export function normalizeBrowserUrl(input: string): string {
  const text = input.trim()

  if (!text) return BROWSER_HOME_URL
  if (/^https?:\/\//i.test(text)) return text
  // Local dev addresses need HTTP, including localhost with a port.
  if (/^(localhost|127\.0\.0\.1|\[::1\])(?=[:/?#]|$)/i.test(text)) return `http://${text}`
  const ipv4 = /^(\d{1,3}(?:\.\d{1,3}){3})(?=[:/?#]|$)/.exec(text)?.[1]

  if (ipv4?.split('.').every((octet) => Number(octet) <= 255)) return `http://${text}`
  if (/^[\w.-]+\.[a-z]{2,}(?=[:/?#]|$)/i.test(text)) return `https://${text}`

  return `https://www.google.com/search?q=${encodeURIComponent(text)}`
}
