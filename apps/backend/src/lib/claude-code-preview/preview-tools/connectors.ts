import { tool } from 'ai'
import { z } from 'zod'

import {
  awsConnectorSchema,
  gcpConnectorSchema,
  azureConnectorSchema,
  tencentConnectorSchema,
  aliyunConnectorSchema,
  volcengineConnectorSchema,
  huaweiConnectorSchema,
} from '@/lib/byos/connector-schemas'
import { createCloudConnector } from '@/lib/byos/create-connector'

import { toolModuleFromAiSdkTools } from './ai-sdk-adapter'

import type { PreviewToolContext, PreviewToolModule } from '../preview-tool-context'

export const createConnectorInput = z
  .object({
    label: z.string().min(1).describe('Short description of this step in the user’s language.'),
    connector: z.discriminatedUnion('provider', [
      awsConnectorSchema
        .omit({ purpose: true })
        .extend({ provider: z.literal('aws') })
        .strict(),
      gcpConnectorSchema
        .omit({ purpose: true })
        .extend({ provider: z.literal('gcp') })
        .strict(),
      azureConnectorSchema
        .omit({ purpose: true })
        .extend({ provider: z.literal('azure') })
        .strict(),
      tencentConnectorSchema.extend({ provider: z.literal('tencent') }).strict(),
      aliyunConnectorSchema.extend({ provider: z.literal('aliyun') }).strict(),
      volcengineConnectorSchema.extend({ provider: z.literal('volcengine') }).strict(),
      huaweiConnectorSchema.extend({ provider: z.literal('huawei') }).strict(),
    ]),
  })
  .strict()

export function connectorToolModule(
  ctx: PreviewToolContext,
  dependencies = { create: createCloudConnector },
  options: Parameters<typeof toolModuleFromAiSdkTools>[1] = {},
): PreviewToolModule {
  return toolModuleFromAiSdkTools(
    {
      create_connector: tool({
        description:
          'Finish connecting a cloud account to the current Nuphos team after setting up its ' +
          'role, service account, or federated app, for example through local_exec. ' +
          'Supports AWS, GCP, Azure, Tencent Cloud, Alibaba Cloud, Volcengine, and Huawei Cloud. ' +
          'Pass the non-secret identifiers from setup; never pass CLI credentials or tokens. ' +
          'Use this tool to complete the user’s requested connection instead of asking them to ' +
          'copy values into Add connector. The backend checks the current user is a team ' +
          'administrator, validates cloud access, and enforces environment limits and uniqueness. ' +
          'It creates an ordinary connector; it does not modify cloud IAM permissions.',
        inputSchema: createConnectorInput,
        execute: async ({ connector }) => {
          const { provider, ...configuration } = connector
          const result = await dependencies.create(
            { userId: ctx.userId, teamId: ctx.teamId },
            provider,
            configuration,
          )

          return {
            provider,
            teamId: ctx.teamId,
            connector: result,
            status: 'connected',
            instruction:
              'The connector is saved and its cloud authentication was verified. Do not ask the user to add it manually.',
          }
        },
      }),
    },
    options,
  )
}
