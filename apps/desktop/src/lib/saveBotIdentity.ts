/** A Bot's face: its character (or photo URL) and the tint a character sits on. */
type Face = { avatar: string | null | undefined; background: string }

/** Save the name and the face independently: keeping one must not discard the other. */
export async function saveBotIdentity(
  title: string,
  draft: string,
  current: Face,
  next: Face,
  actions: {
    rename: (name: string) => Promise<void>
    setAvatar: (avatar: string, background: string) => Promise<void>
  },
) {
  const name = draft.trim()

  if (!name) return
  if (name !== title) await actions.rename(name)
  // A photo Bot has no character picked, so there is no face to save.
  if (!next.avatar) return
  if (next.avatar !== current.avatar || next.background !== current.background)
    await actions.setAvatar(next.avatar, next.background)
}
