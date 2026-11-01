import { t } from '../../i18n/index.ts'

import type { SignInSession } from '../../types'

const APPS: Record<string, string> = {
  'nuphos-desktop': 'Nuphos Desktop',
  'nuphos-ios': t('Nuphos for iOS'),
  'nuphos-android': t('Nuphos for Android'),
  'nuphos-cli': 'Nuphos CLI',
}
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
 * client sent, so none of their text is shown, not even an app's version: a
 * known app, a browser and system from a fixed list, or "Unknown device" (as
 * the backend's emails do).
 */
export function sessionDevice(session: Pick<SignInSession, 'client' | 'userAgent'>): string {
  const app = session.client?.split('/')[0] ?? ''

  if (Object.hasOwn(APPS, app)) return APPS[app]!
  const ua = session.userAgent ?? ''

  // The nuphos.ai web sign-in reaches the backend from the website's server.
  if (!session.client && /^(node|undici)\b/i.test(ua)) return t('Web sign-in (nuphos.ai)')
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1]
  const system = SYSTEMS.find(([re]) => re.test(ua))?.[1]

  if (browser && system) return t('{browser} on {system}', { browser, system })

  return browser ?? (system ? t('A browser on {system}', { system }) : t('Unknown device'))
}

export function sessionPlace(session: Pick<SignInSession, 'city' | 'country' | 'ip'>): string {
  const place = [session.city, session.country].filter(Boolean).join(', ')

  return [place || t('Unknown location'), session.ip].filter(Boolean).join(' · ')
}

/** This device first, then the most recently active. */
export function sortSessions(sessions: SignInSession[]): SignInSession[] {
  return sessions.toSorted(
    (a, b) => Number(b.current) - Number(a.current) || b.lastUsedAt.localeCompare(a.lastUsedAt),
  )
}
