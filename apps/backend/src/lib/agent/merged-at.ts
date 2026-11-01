import { z } from 'zod'

const timestamp = z.string().datetime({ offset: true })

/** GitHub's merged_at, or undefined when it is missing or not a valid time. */
export function mergedAtOf(value: string | null | undefined): string | undefined {
  const parsed = timestamp.safeParse(value)

  return parsed.success ? parsed.data : undefined
}
