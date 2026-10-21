/**
 * How the signed-in account changed when the main process reloaded this
 * window for it (`?account=added|switched|signedOut`), read once at load and
 * taken out of the address so a later reload does not repeat it.
 */
export type AccountChangeKind = 'added' | 'switched' | 'signedOut'

const KINDS: readonly string[] = ['added', 'switched', 'signedOut']

export function takeAccountChange(location: Pick<Location, 'href'>, history?: History) {
  const url = new URL(location.href)
  const change = url.searchParams.get('account')

  if (change === null) return null
  url.searchParams.delete('account')
  history?.replaceState(history.state, '', url)

  return KINDS.includes(change) ? (change as AccountChangeKind) : null
}

export const accountChange: AccountChangeKind | null =
  typeof window === 'undefined' ? null : takeAccountChange(window.location, window.history)
