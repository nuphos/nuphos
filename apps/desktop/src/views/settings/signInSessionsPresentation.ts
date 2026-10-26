import type { SignInSession } from '../../types'

const APPS: Record<string, string> = {
  'nuphos-desktop': 'Nuphos Desktop',
  'nuphos-ios': 'Nuphos for iOS',
  'nuphos-android': 'Nuphos for Android',
  'nuphos-cli': 'Nuphos CLI',
}
const APP_CLIENT = /^(nuphos-(?:desktop|ios|android|cli))\/([0-9][\w.+-]{0,31})$/
const BROWSERS: [RegExp, string][] = [
  [/Edg\//, 'Edge'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
]
const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPad/, 'iOS'],
  [/Android/, 'Android'],
  [/Macintosh|Mac OS X/, 'macOS'],
  [/Windows/, 'Windows'],
  [/Linux/, 'Linux'],
]

/**
 * What signed in. The app name and user agent are whatever the signing-in
 * client sent, so their text is never shown: a known app, a browser and system
 * from a fixed list, or "Unknown device" (as the backend's emails do).
 */
export function sessionDevice(session: Pick<SignInSession, 'client' | 'userAgent'>): string {
  const app = APP_CLIENT.exec(session.client ?? '')

  if (app) return `${APPS[app[1]!]!} ${app[2]!}`
  const ua = session.userAgent ?? ''

  // The nuphos.ai web sign-in reaches the backend from the website's server.
  if (!session.client && /^(node|undici)\b/i.test(ua)) return 'Web sign-in (nuphos.ai)'
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1]
  const system = SYSTEMS.find(([re]) => re.test(ua))?.[1]

  if (browser && system) return `${browser} on ${system}`

  return browser ?? (system ? `A browser on ${system}` : 'Unknown device')
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
