import { z } from 'zod'

export type SessionConfigOption = {
  id: string
  name: string
  kind: 'model' | 'effort' | 'fast'
  description?: string
  currentValue: string
  options: { value: string; name: string; description?: string }[]
}
export type SessionConfigState = {
  status: 'ready' | 'busy' | 'dormant' | 'unsupported' | 'offline'
  options: SessionConfigOption[]
}
export type SessionConfigSelection = { configId: string; value: string }

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function configKind(option: Record<string, unknown>): SessionConfigOption['kind'] | null {
  if (option.category === 'model' || option.id === 'model') return 'model'
  if (
    ['reasoning_effort', 'effort', 'thinking'].includes(String(option.id)) ||
    option.category === 'thought_level'
  )
    return 'effort'
  if (['fast-mode', 'fast_mode', 'fast'].includes(String(option.id))) return 'fast'

  return null
}

/** Expose only runtime-advertised model controls, never permission or tool modes. */
export function parseSessionConfigOptions(value: unknown): SessionConfigOption[] {
  if (!Array.isArray(value)) throw new Error('Runtime did not return configuration options')

  return value.flatMap((raw) => {
    const option = record(raw)
    const kind = option && configKind(option)

    if (
      !option ||
      !kind ||
      typeof option.id !== 'string' ||
      typeof option.name !== 'string' ||
      typeof option.currentValue !== 'string' ||
      !Array.isArray(option.options)
    )
      return []
    const choices = option.options.flatMap((rawChoice: unknown) => {
      const choice = record(rawChoice)

      if (!choice || typeof choice.value !== 'string' || typeof choice.name !== 'string') return []

      return [
        {
          value: choice.value,
          name: choice.name,
          ...(typeof choice.description === 'string' ? { description: choice.description } : {}),
        },
      ]
    })

    return [
      {
        id: option.id,
        name: option.name,
        kind,
        currentValue: option.currentValue,
        options: choices,
        ...(typeof option.description === 'string' ? { description: option.description } : {}),
      },
    ]
  })
}

/** Model settings picked before a session exists, by option id. */
export const sessionConfigPickSchema = z
  .object({
    model: z.string().trim().min(1).max(500).optional(),
    effort: z.string().trim().min(1).max(100).optional(),
    fast: z.enum(['on', 'off']).optional(),
  })
  .strict()
