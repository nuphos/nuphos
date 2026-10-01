type UpdateChannelTarget = {
  channel: string | null
  allowPrerelease: boolean
  allowDowngrade: boolean
}

/**
 * Nuphos publishes only the stable `latest` manifests. electron-updater
 * otherwise derives a channel from prerelease app versions, which makes an
 * old beta client request a manifest such as beta-linux-arm64.yml that the
 * release pipeline intentionally never publishes.
 */
export function configureStableUpdateChannel(updater: UpdateChannelTarget): void {
  // Setting channel enables downgrades inside electron-updater, so restore the
  // production policy explicitly after selecting the stable feed.
  updater.channel = 'latest'
  updater.allowPrerelease = false
  updater.allowDowngrade = false
}
