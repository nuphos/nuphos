import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { zodToJsonSchema } from 'zod-to-json-schema'

import { assertApiOperationSchemas, atlasApiOperations } from '../src/lib/api'

import type { ApiOperation } from '../src/lib/api'
import type { z } from 'zod'

type JsonSchema = Record<string, unknown>

const checkOnly = process.argv.includes('--check')
const openApiPath = fileURLToPath(new URL('../src/generated/api/openapi.json', import.meta.url))

function schemaName(operation: ApiOperation, kind: string): string {
  return `${operation.operationId.replace(/\./g, '_')}_${kind}`
}

function toJsonSchema(schema: z.ZodTypeAny, name: string): JsonSchema {
  const converted = zodToJsonSchema(schema, {
    name,
    target: 'openApi3',
    $refStrategy: 'none',
  })
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize)
    if (!value || typeof value !== 'object') return value
    const out: Record<string, unknown> = {}

    for (const [key, child] of Object.entries(value)) out[key] = normalize(child)
    if (out.exclusiveMinimum === true && typeof out.minimum === 'number') {
      out.exclusiveMinimum = out.minimum
      delete out.minimum
    } else if (out.exclusiveMinimum === false) {
      delete out.exclusiveMinimum
    }
    if (out.exclusiveMaximum === true && typeof out.maximum === 'number') {
      out.exclusiveMaximum = out.maximum
      delete out.maximum
    } else if (out.exclusiveMaximum === false) {
      delete out.exclusiveMaximum
    }

    return out
  }

  if (
    converted &&
    typeof converted === 'object' &&
    'definitions' in converted &&
    converted.definitions &&
    typeof converted.definitions === 'object' &&
    name in converted.definitions
  ) {
    return normalize(converted.definitions[name]) as JsonSchema
  }
  const { $schema: _schema, definitions: _definitions, ...rest } = converted as JsonSchema

  return normalize(rest) as JsonSchema
}

function parametersFromSchema(
  operation: ApiOperation,
  location: 'path' | 'query',
  schema: z.ZodTypeAny | undefined,
): JsonSchema[] {
  if (!schema) return []
  const json = toJsonSchema(schema, schemaName(operation, location))
  const properties =
    json.properties && typeof json.properties === 'object'
      ? (json.properties as Record<string, JsonSchema>)
      : {}
  const required = Array.isArray(json.required)
    ? new Set(json.required as string[])
    : new Set<string>()

  return Object.entries(properties).map(([name, propertySchema]) => ({
    name,
    in: location,
    required: location === 'path' || required.has(name),
    schema: propertySchema,
  }))
}

function buildOpenApi() {
  const paths: Record<string, Record<string, JsonSchema>> = {}

  for (const operation of atlasApiOperations) {
    assertApiOperationSchemas(operation)
    const path = operation.path.replace(/:(\w+)/g, '{$1}')

    paths[path] ??= {}
    const parameters = [
      ...parametersFromSchema(operation, 'path', operation.pathSchema),
      ...parametersFromSchema(operation, 'query', operation.querySchema),
    ]
    const requestSchema = operation.requestSchema
      ? toJsonSchema(operation.requestSchema, schemaName(operation, 'request'))
      : null
    const responseSchema = toJsonSchema(operation.responseSchema, schemaName(operation, 'response'))

    paths[path][operation.method] = {
      operationId: operation.operationId,
      tags: operation.tags,
      summary: operation.summary,
      description: operation.description,
      ...(operation.auth === 'bearer' ? { security: [{ bearerAuth: [] }] } : {}),
      ...(parameters.length ? { parameters } : {}),
      ...(requestSchema
        ? {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: requestSchema,
                },
              },
            },
          }
        : {}),
      responses: {
        200: {
          description: 'OK',
          content: {
            'application/json': {
              schema: responseSchema,
            },
          },
        },
        400: { description: 'Invalid request' },
        401: { description: 'Unauthorized' },
        404: { description: 'Not found' },
      },
    }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Nuphos API',
      version: '0.1.0',
      description: 'Generated from the Nuphos API operation registry.',
    },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
        },
      },
    },
    paths,
  }
}

async function writeGenerated(path: string, value: unknown) {
  const next = `${JSON.stringify(value, null, 2)}\n`

  if (checkOnly) {
    const current = await readFile(path, 'utf8').catch(() => null)

    if (current !== next) {
      throw new Error(`${path} is stale. Run: bun run generate:api`)
    }

    return
  }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, next)
}

await writeGenerated(openApiPath, buildOpenApi())

if (!checkOnly) {
  console.log(`Generated ${openApiPath}`)
}
