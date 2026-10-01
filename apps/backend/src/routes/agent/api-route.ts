import { assertApiOperationSchemas, routePathForMount } from '@/lib/api'
import { AppError } from '@/lib/errors'

import { agent } from './router'

import type { ApiOperation } from '@/lib/api'
import type { AuthVariables } from '@/middleware/auth'
import type { Context } from 'hono'
import type { z } from 'zod'

export function parseWithSchema<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
  errorCode: 'invalid_body' | 'invalid_request',
): z.infer<T> {
  const parsed = schema.safeParse(value)

  if (parsed.success) return parsed.data
  const detail = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || 'value'}: ${issue.message}`)
    .join('; ')

  throw new AppError(400, errorCode, detail)
}

type InferOptionalSchema<T> = T extends z.ZodTypeAny ? z.infer<T> : undefined

type ApiRouteInput<T extends ApiOperation> = {
  path: InferOptionalSchema<T['pathSchema']>
  query: InferOptionalSchema<T['querySchema']>
  body: InferOptionalSchema<T['requestSchema']>
}

type AgentRouteContext = Context<{ Variables: AuthVariables }>

async function readApiRouteInput<T extends ApiOperation>(
  operation: T,
  c: AgentRouteContext,
): Promise<ApiRouteInput<T>> {
  let body: unknown

  if (operation.requestSchema) {
    try {
      body = await c.req.json()
    } catch {
      throw new AppError(400, 'invalid_body', 'Body must be JSON')
    }
  }

  return {
    path: operation.pathSchema
      ? parseWithSchema(operation.pathSchema, c.req.param(), 'invalid_request')
      : undefined,
    query: operation.querySchema
      ? parseWithSchema(operation.querySchema, c.req.query(), 'invalid_request')
      : undefined,
    body: operation.requestSchema
      ? parseWithSchema(operation.requestSchema, body, 'invalid_body')
      : undefined,
  }
}

export function defineAgentApiRoute<T extends ApiOperation>(
  operation: T,
  handler: (c: AgentRouteContext, input: ApiRouteInput<T>) => Response | Promise<Response>,
): void {
  assertApiOperationSchemas(operation)
  const register = agent[operation.method] as unknown as (
    path: string,
    handler: (c: AgentRouteContext) => Response | Promise<Response>,
  ) => void

  register.call(agent, routePathForMount(operation, '/agent'), async (c) => {
    return handler(c, await readApiRouteInput(operation, c))
  })
}
