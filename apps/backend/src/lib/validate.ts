import { zValidator as origZValidator } from '@hono/zod-validator'

import { AppError } from '@/lib/errors'

import type { MiddlewareHandler } from 'hono'
import type { z, ZodSchema } from 'zod'

type Target = 'json' | 'query' | 'param' | 'header' | 'cookie' | 'form'
type ValidatedInput<T extends ZodSchema, K extends Target> = {
  in: Record<K, z.input<T>>
  out: Record<K, z.output<T>>
}

export function zv<T extends ZodSchema, K extends Target>(
  target: K,
  schema: T,
): MiddlewareHandler<object, string, ValidatedInput<T, K>, never> {
  return origZValidator(target, schema, (result) => {
    if (!result.success) {
      throw new AppError(400, 'validation_error', 'Invalid input', result.error.flatten())
    }
  }) as unknown as MiddlewareHandler<object, string, ValidatedInput<T, K>, never>
}
