type UpdaterAnalyticsEvent = 'update_available' | 'update_downloaded'

/**
 * electron-updater re-emits update-available / update-downloaded on every
 * poll while an update sits pending, so raw captures scale with polling
 * frequency, not with actual updates. Gate analytics to one capture per
 * (event, version) per process; a restart (which installs the update) resets
 * naturally.
 */
export function createUpdaterEventDedupe(): (
  event: UpdaterAnalyticsEvent,
  version: string,
) => boolean {
  const seen = new Set<string>()

  return (event, version) => {
    const key = `${event}:${version}`

    if (seen.has(key)) return false
    seen.add(key)

    return true
  }
}
