/** A Trigger a Bot was set up with, named on the line above its first message. */
export type CreatedTrigger = { id: string; name: string }

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value !== ''

export function parseCreatedTriggers(value: unknown): CreatedTrigger[] | undefined {
  if (!Array.isArray(value)) return undefined
  const triggers = value
    .slice(0, 64)
    .flatMap((item: Partial<CreatedTrigger> | null) =>
      item && nonEmpty(item.id) && nonEmpty(item.name) ? [{ id: item.id, name: item.name }] : [],
    )

  return triggers.length > 0 ? triggers : undefined
}
