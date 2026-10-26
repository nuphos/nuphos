import type { SignInSession } from '../../types'

const APPS: Record<string, string> = {
  'nuphos-desktop': 'Nuphos Desktop',
  'nuphos-ios': 'Nuphos for iOS',
  'nuphos-android': 'Nuphos for Android',
  'nuphos-cli': 'Nuphos CLI',
}

/** What signed in: the app's own name when it sent one, else a guess from the user agent. */
export function sessionDevice(session: Pick<SignInSession, 'client' | 'userAgent'>): string {
  const [name, version] = (session.client ?? '').split('/')
  const app = name ? APPS[name] : undefined

  if (app) return version ? `${app} ${version}` : app
  if (session.client) return session.client
  const ua = session.userAgent ?? ''

  // The nuphos.ai web sign-in reaches the backend from the website's server.
  if (/^(node|undici)\b/i.test(ua)) return 'Web sign-in (nuphos.ai)'
  if (/Mozilla\//.test(ua)) return 'Web browser'

  return ua ? ua.slice(0, 60) : 'Unknown device'
}

export function sessionPlace(session: Pick<SignInSession, 'city' | 'country' | 'ip'>): string {
  const place = [session.city, session.country].filter(Boolean).join(', ')

  return [place || 'Unknown location', session.ip].filter(Boolean).join(' · ')
}

/** This device first, then the most recently active. */
export function sortSessions(sessions: SignInSession[]): SignInSession[] {
  return sessions.toSorted(
    (a, b) => Number(b.current) - Number(a.current) || b.lastUsedAt.localeCompare(a.lastUsedAt),
  )
}
