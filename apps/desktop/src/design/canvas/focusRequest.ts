// A screen added from elsewhere in this window (Add to design) asks the canvas
// showing its design to bring it into view once the screen has synced in.
const pending = new Map<string, string>()

export function requestFocus(designId: string, objectId: string) {
  pending.set(designId, objectId)
}

/** The object to bring into view, once `has` says it is on the page shown; asked for once. */
export function takeFocus(designId: string, has: (id: string) => boolean): string | null {
  const id = pending.get(designId)

  if (!id || !has(id)) return null
  pending.delete(designId)

  return id
}
