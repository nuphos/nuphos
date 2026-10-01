import { BrowserWindow, net } from 'electron'

import { CHANGELOG_FEED_URL, parseChangelogFeed } from './changelog-feed'

import type { ChangelogEntry } from './changelog-feed'

export type ChangelogState = { kind: 'unavailable' } | { kind: 'ready'; entries: ChangelogEntry[] }

const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 10_000

let changelogState: ChangelogState = { kind: 'unavailable' }
let changelogTimer: ReturnType<typeof setInterval> | null = null
let fetchInFlight = false

function setChangelogState(next: ChangelogState) {
  changelogState = next
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('changelog:status', next)
  }
}

export function getChangelogState(): ChangelogState {
  return changelogState
}

export async function fetchChangelogOnce() {
  if (fetchInFlight) return
  fetchInFlight = true
  try {
    // Chromium's network stack (same as the reader webview), NOT Node's
    // global fetch: undici's happy-eyeballs gives each connect attempt only
    // ~250ms, which times out wholesale on slow networks/VPNs where curl and
    // the webview connect fine — and it also ignores system proxy settings.
    const res = await net.fetch(CHANGELOG_FEED_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })

    if (!res.ok) throw new Error(`changelog feed http ${String(res.status)}`)
    const entries = parseChangelogFeed(await res.json())

    if (entries && entries.length > 0) setChangelogState({ kind: 'ready', entries })
    else setChangelogState({ kind: 'unavailable' })
  } catch {
    // Expected until the landing-page feed ships, and on any network failure:
    // the What's New UI simply stays hidden. Never surface this to the user.
    setChangelogState({ kind: 'unavailable' })
  } finally {
    fetchInFlight = false
  }
}

export function startChangelogPolling() {
  if (changelogTimer) return
  void fetchChangelogOnce()
  changelogTimer = setInterval(() => void fetchChangelogOnce(), POLL_INTERVAL_MS)
}
