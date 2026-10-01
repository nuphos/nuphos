import { z } from 'zod'

import { objectIdStringSchema, teamPathSchema } from './paths'

export const tencentAccountPathSchema = teamPathSchema.extend({
  accountId: objectIdStringSchema.describe('Nuphos Tencent account binding id.'),
})

export const tencentCredentialsSchema = z.object({
  secretId: z.string().min(1),
  secretKey: z.string().min(1),
  token: z.string().min(1).describe('STS token accompanying the assumed-role secretId/secretKey.'),
  site: z
    .enum(['china', 'international'])
    .describe(
      'Tencent Cloud partition: china (cloud.tencent.com) or international (tencentcloud.com).',
    ),
  defaultRegion: z
    .string()
    .describe(
      'A region the credentials can authenticate against for this partition (e.g. ap-guangzhou / ap-singapore).',
    ),
})

const tencentClusterSchema = z.object({
  provider: z.literal('tencent'),
  name: z.string(),
  region: z.string(),
  status: z.string().optional(),
  version: z.string().optional(),
  createdAt: z.string().optional(),
  tencentClusterId: z.string().optional(),
  tencentAccountId: z.string().optional(),
})

export const tencentClustersResponseSchema = z.object({
  clusters: z.array(tencentClusterSchema),
  errors: z.array(z.object({ region: z.string().optional(), message: z.string() })),
})

export const aliyunAccountPathSchema = teamPathSchema.extend({
  accountId: objectIdStringSchema.describe('Nuphos Alibaba Cloud account binding id.'),
})

export const aliyunCredentialsSchema = z.object({
  accessKeyId: z.string().min(1),
  accessKeySecret: z.string().min(1),
  securityToken: z
    .string()
    .min(1)
    .describe('STS security token accompanying the assumed-role AccessKeyId/Secret.'),
  site: z
    .enum(['china', 'international'])
    .describe('Alibaba Cloud partition: china (aliyun.com) or international (alibabacloud.com).'),
  defaultRegion: z
    .string()
    .describe(
      'A region the credentials can authenticate against for this partition (e.g. cn-hangzhou / ap-southeast-1).',
    ),
})

const aliyunClusterSchema = z.object({
  provider: z.literal('aliyun'),
  name: z.string(),
  region: z.string(),
  status: z.string().optional(),
  version: z.string().optional(),
  createdAt: z.string().optional(),
  aliyunClusterId: z.string().optional(),
  aliyunAccountId: z.string().optional(),
})

export const aliyunClustersResponseSchema = z.object({
  clusters: z.array(aliyunClusterSchema),
  errors: z.array(z.object({ region: z.string().optional(), message: z.string() })),
})

export const huaweiAccountPathSchema = teamPathSchema.extend({
  accountId: objectIdStringSchema.describe('Nuphos Huawei Cloud account binding id.'),
})

export const huaweiCredentialsSchema = z.object({
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  securityToken: z
    .string()
    .min(1)
    .describe('Security token accompanying the temporary federated AK/SK.'),
  expiresAt: z.string().describe('ISO-8601 instant the temporary credentials expire.'),
  domainId: z.string().describe('Huawei Cloud account (domain) id the credentials belong to.'),
  defaultRegion: z
    .string()
    .describe('A region the credentials can authenticate against (e.g. cn-north-4).'),
})

export const volcengineAccountPathSchema = teamPathSchema.extend({
  accountId: objectIdStringSchema.describe('Nuphos Volcengine account binding id.'),
})

export const volcengineCredentialsSchema = z.object({
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  sessionToken: z
    .string()
    .min(1)
    .describe('STS session token accompanying the short-lived assumed-role credentials.'),
  defaultRegion: z
    .string()
    .describe('A region the credentials can authenticate against (e.g. cn-beijing).'),
})

const volcengineClusterSchema = z.object({
  provider: z.literal('volcengine'),
  name: z.string(),
  region: z.string(),
  status: z.string().optional(),
  version: z.string().optional(),
  createdAt: z.string().optional(),
  volcengineClusterId: z.string().optional(),
  volcengineAccountId: z.string().optional(),
})

export const volcengineClustersResponseSchema = z.object({
  clusters: z.array(volcengineClusterSchema),
  errors: z.array(z.object({ region: z.string().optional(), message: z.string() })),
})

const volcengineEcsInstanceSchema = z.object({
  instanceId: z.string(),
  name: z.string(),
  instanceType: z.string(),
  state: z.string(),
  region: z.string(),
  zone: z.string(),
  publicIp: z.string().nullable(),
  privateIp: z.string().nullable(),
  cpu: z.number().nullable(),
  memoryGb: z.number().nullable(),
  osName: z.string().nullable(),
  imageId: z.string().nullable(),
  createdAt: z.string().nullable(),
})

export const volcengineEcsResponseSchema = z.object({
  instances: z.array(volcengineEcsInstanceSchema),
  errors: z.array(z.object({ region: z.string().optional(), message: z.string() })),
})

const aliyunEcsInstanceSchema = z.object({
  instanceId: z.string(),
  name: z.string(),
  instanceType: z.string(),
  state: z.string(),
  region: z.string(),
  zone: z.string(),
  publicIp: z.string().nullable(),
  privateIp: z.string().nullable(),
  cpu: z.number().nullable(),
  memoryGb: z.number().nullable(),
  osName: z.string().nullable(),
  imageId: z.string().nullable(),
  createdAt: z.string().nullable(),
})

export const aliyunEcsResponseSchema = z.object({
  instances: z.array(aliyunEcsInstanceSchema),
  errors: z.array(z.object({ region: z.string().optional(), message: z.string() })),
})

const aliyunSwasInstanceSchema = z.object({
  instanceId: z.string(),
  name: z.string(),
  plan: z.string(),
  status: z.string(),
  businessStatus: z.string().nullable(),
  region: z.string(),
  publicIp: z.string().nullable(),
  privateIp: z.string().nullable(),
  cpu: z.number().nullable(),
  memoryGb: z.number().nullable(),
  diskGb: z.number().nullable(),
  osName: z.string().nullable(),
  imageId: z.string().nullable(),
  createdAt: z.string().nullable(),
  expiredAt: z.string().nullable(),
})

export const aliyunSwasResponseSchema = z.object({
  instances: z.array(aliyunSwasInstanceSchema),
  errors: z.array(z.object({ region: z.string().optional(), message: z.string() })),
})
