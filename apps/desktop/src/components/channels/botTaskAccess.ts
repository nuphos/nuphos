/** Existing session read permission, never channel membership, grants Task access. */
export async function readBotTaskAccess(
  owned: boolean,
  read: () => Promise<unknown>,
): Promise<boolean> {
  if (owned) return true
  try {
    await read()

    return true
  } catch {
    return false
  }
}
