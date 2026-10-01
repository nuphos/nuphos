import type { z } from 'zod'

export type HttpMethod = 'get' | 'post' | 'patch' | 'put' | 'delete'
export type ApiAuth = 'bearer' | 'none'

export type ApiOperation = {
  operationId: string
  method: HttpMethod
  path: string
  tags: string[]
  summary: string
  description: string
  auth: ApiAuth
  pathSchema?: z.ZodTypeAny
  querySchema?: z.ZodTypeAny
  requestSchema?: z.ZodTypeAny
  responseSchema: z.ZodTypeAny
  agent?: {
    toolName: string
    readOnly: boolean
    description: string
    inputSchema?: z.AnyZodObject
    requiresNonEmptyPatch?: boolean
  }
}

const methodsWithJsonBody = new Set<HttpMethod>(['post', 'patch', 'put'])

export function assertApiOperationSchemas(operation: ApiOperation): void {
  const hasPathParams = /\{[^{}]+\}/.test(operation.path) || /:\w+/.test(operation.path)

  if (hasPathParams && !operation.pathSchema) {
    throw new Error(`API operation ${operation.operationId} is missing pathSchema`)
  }
  if (methodsWithJsonBody.has(operation.method) && !operation.requestSchema) {
    throw new Error(`API operation ${operation.operationId} is missing requestSchema`)
  }
}

export function routePathForMount(operation: ApiOperation, mountPath: string): string {
  if (!operation.path.startsWith(`${mountPath}/`)) {
    throw new Error(`API operation ${operation.operationId} must use ${mountPath} path prefix`)
  }

  return operation.path.slice(mountPath.length).replace(/\{([^{}]+)\}/g, ':$1')
}

export function byOperationId(operations: readonly ApiOperation[]): Map<string, ApiOperation> {
  return new Map(operations.map((operation) => [operation.operationId, operation]))
}
