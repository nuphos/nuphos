/** Save either field independently: keeping a name must not discard a new face. */
export async function saveBotIdentity(
  title: string,
  draft: string,
  currentAvatar: string | null | undefined,
  avatar: string | undefined,
  actions: {
    rename: (name: string) => Promise<void>
    setAvatar: (avatar: string) => Promise<void>
  },
) {
  const name = draft.trim()

  if (!name) return
  if (name !== title) await actions.rename(name)
  if (avatar !== undefined && avatar !== currentAvatar) await actions.setAvatar(avatar)
}
