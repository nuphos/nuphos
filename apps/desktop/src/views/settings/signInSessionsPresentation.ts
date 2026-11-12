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

/**
 * City and country as Cloudflare guessed them — what a row shows as its location.
 *
 * The IP is deliberately not in here. It is long and it is not something a person
 * recognizes, so on the row it pushed the last-active time out of view; it stays
 * available on hover instead, through `sessionPlace`.
 */
export function sessionLocation(session: Pick<SignInSession, 'city' | 'country'>): string {
  return [session.city, session.country].filter(Boolean).join(', ') || t('Unknown location')
}

/** The location and the address behind it: the detail a row shows on hover. */
export function sessionPlace(session: Pick<SignInSession, 'city' | 'country' | 'ip'>): string {
  return [sessionLocation(session), session.ip].filter(Boolean).join(' · ')
}

/** This device first, then the most recently active. */
export function sortSessions(sessions: SignInSession[]): SignInSession[] {
  return sessions.toSorted(
    (a, b) => Number(b.current) - Number(a.current) || b.lastUsedAt.localeCompare(a.lastUsedAt),
  )
}
