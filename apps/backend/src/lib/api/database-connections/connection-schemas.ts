import { z } from 'zod'

import { allowListSchema } from '@/lib/byos/access'

import { databaseChangeApprovalPolicySchema } from './request-schemas'
import { objectIdSchema } from './shared'

export const databaseEngineSchema = z.enum(['mongodb', 'postgresql', 'mysql'])
export const databaseResourceEngineSchema = z.union([
  databaseEngineSchema,
  z.literal('cloudflare-d1'),
])

export const databaseNetworkModeSchema = z.enum(['public', 'tailscale', 'cluster-relay'])
export const databaseTailscaleNetworkSchema = z
  .object({
    bindingId: objectIdSchema,
    tag: z
      .string()
      .trim()
      .regex(/^tag:[a-z0-9][a-z0-9-]{0,62}$/i, 'Use a Tailscale tag such as tag:nuphos-database'),
  })
  .strict()
export const databaseAgentPolicySchema = z.enum(['disabled', 'metadata-only', 'read-only'])
export const databaseRelationSchema = z
  .object({
    kind: z.enum(['service', 'deployment', 'cluster', 'repository']),
    id: z.string().trim().min(1).max(256),
    label: z.string().trim().min(1).max(256).optional(),
  })
  .strict()

export const databaseAccessInputSchema = z
  .object({
    memberAllowList: allowListSchema.default(['*']),
    agentPolicy: databaseAgentPolicySchema.default('disabled'),
  })
  .strict()

const connectionFields = {
  name: z.string().trim().min(1).max(100),
  engine: databaseEngineSchema,
  connectionUri: z.string().min(1).max(8_192),
  environment: z.string().trim().min(1).max(100),
  tags: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  networkMode: databaseNetworkModeSchema.default('public'),
  tailscale: databaseTailscaleNetworkSchema.optional(),
  access: databaseAccessInputSchema.default({ memberAllowList: ['*'], agentPolicy: 'disabled' }),
  relations: z.array(databaseRelationSchema).max(200).default([]),
}

function validateNetworkSelection(
  value: { networkMode?: 'public' | 'tailscale' | 'cluster-relay'; tailscale?: unknown },
  ctx: z.RefinementCtx,
): void {
  if (value.networkMode === 'tailscale' && !value.tailscale) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['tailscale'],
      message: 'Select a Tailscale OAuth binding and tag',
    })
  }
  if (value.networkMode === 'cluster-relay') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['networkMode'],
      message: 'Cluster relay is not available yet',
    })
  }
  if (value.networkMode === 'public' && value.tailscale) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['tailscale'],
      message: 'Tailscale configuration is only valid in tailscale network mode',
    })
  }
}

export const databaseConnectionCreateSchema = z
  .object(connectionFields)
  .strict()
  .superRefine(validateNetworkSelection)

export const databaseConnectionUpdateSchema = z
  .object({
    name: connectionFields.name.optional(),
    engine: connectionFields.engine.optional(),
    connectionUri: connectionFields.connectionUri.optional(),
    environment: connectionFields.environment.optional(),
    tags: connectionFields.tags.optional(),
    networkMode: connectionFields.networkMode.optional(),
    tailscale: connectionFields.tailscale.optional(),
    access: connectionFields.access.optional(),
    changeApprovalPolicy: databaseChangeApprovalPolicySchema.optional(),
    relations: connectionFields.relations.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide at least one database connection setting to update',
      })
    }
    if (value.engine && !value.connectionUri) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['connectionUri'],
        message: 'connectionUri is required when changing engine',
      })
    }
    if (value.networkMode !== undefined) validateNetworkSelection(value, ctx)
  })

export const databaseConnectionTestSchema = z
  .object({
    engine: databaseEngineSchema,
    connectionUri: connectionFields.connectionUri,
    networkMode: databaseNetworkModeSchema.default('public'),
    tailscale: databaseTailscaleNetworkSchema.optional(),
  })
  .strict()
  .superRefine(validateNetworkSelection)
