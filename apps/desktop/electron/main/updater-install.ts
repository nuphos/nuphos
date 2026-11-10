type Check = { updateInfo: { version: string }; downloadPromise?: Promise<unknown> | null } | null

/**
 * Waits until a restart would install the newest release. `check` is a check
 * made when the user asked to restart, after `staged` finished downloading;
 * releases ship often, so a newer one may be out by then. `stagedByOs` resolves
 * once the OS installer has that download too (Squirrel.Mac gets it after
 * electron-updater does). Resolves false if the newer release failed to download.
 */
export async function awaitLatestStaged(
  check: Check,
  staged: string,
  stagedByOs: () => Promise<unknown>,
): Promise<boolean> {
  if (!check?.downloadPromise || check.updateInfo.version === staged) return true

  return Promise.all([check.downloadPromise, stagedByOs()]).then(
    () => true,
    () => false,
  )
}
