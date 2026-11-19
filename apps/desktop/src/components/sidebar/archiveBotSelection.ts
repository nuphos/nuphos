import type { Item } from './types'

/** Keep the Bot conversation surface open when its current Bot is archived. */
export function nextBotAfterArchive(
  bots: Item[],
  selectedId: string | null,
  archivedId: string,
  archiving: ReadonlySet<string>,
): Item | undefined {
  if (selectedId !== archivedId) return undefined
  const sessionOf = (item: Item) => item.key.replace('agent-session:', '')
  const current = bots.find((item) => sessionOf(item) === selectedId)
  const owner = current?.botChannelOf ?? selectedId

  return bots.find((item) => {
    const id = sessionOf(item)

    return (
      item.enabled &&
      !item.parentKey &&
      !item.botNested &&
      id !== selectedId &&
      id !== owner &&
      item.botChannelOf !== owner &&
      !archiving.has(id) &&
      !archiving.has(item.botChannelOf ?? '')
    )
  })
}
