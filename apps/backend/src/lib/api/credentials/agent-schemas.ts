import { z } from 'zod'

import { objectIdStringSchema, zeaburIdStringSchema } from './paths'

export const agentCredentialSelectionSchema = z.object({
  awsRoleIds: z.array(objectIdStringSchema).default([]),
  gcpServiceAccountIds: z.array(objectIdStringSchema).default([]),
  linodeAccountIds: z.array(objectIdStringSchema).default([]),
  hetznerAccountIds: z.array(objectIdStringSchema).default([]),
  tencentAccountIds: z.array(objectIdStringSchema).default([]),
  aliyunAccountIds: z.array(objectIdStringSchema).default([]),
  volcengineAccountIds: z.array(objectIdStringSchema).default([]),
  huaweiAccountIds: z.array(objectIdStringSchema).default([]),
  azureAccountIds: z.array(objectIdStringSchema).default([]),
  onpremClusterIds: z.array(objectIdStringSchema).default([]),
  betterStackIntegrationIds: z.array(objectIdStringSchema).default([]),
  uptimeKumaInstanceIds: z.array(objectIdStringSchema).default([]),
  tailscaleClientIds: z.array(objectIdStringSchema).default([]),
  zeaburIds: z.array(zeaburIdStringSchema).default([]),
  vantaIntegrationIds: z.array(objectIdStringSchema).default([]),
  secureframeIntegrationIds: z.array(objectIdStringSchema).default([]),
  resendIntegrationIds: z.array(objectIdStringSchema).default([]),
  // Left optional on purpose: undefined means "not narrowed", which for these
  // connectors is still team-wide reach, unlike an explicit empty list.
  githubInstallationIds: z.array(z.string().min(1)).optional(),
  gitlabBindingIds: z.array(objectIdStringSchema).optional(),
  grafanaInstanceIds: z.array(objectIdStringSchema).optional(),
  sonarqubeIntegrationIds: z.array(objectIdStringSchema).optional(),
  notionIntegrationIds: z.array(objectIdStringSchema).optional(),
  upstashAccountIds: z.array(objectIdStringSchema).optional(),
  cloudflareAccountIds: z.array(z.string().min(1)).optional(),
  deviceIds: z.array(z.string().min(1)).default([]),
})

const agentCredentialAccessSchema = z.object({
  awsRoleIds: z.array(objectIdStringSchema),
  gcpServiceAccountIds: z.array(objectIdStringSchema),
  linodeAccountIds: z.array(objectIdStringSchema),
  hetznerAccountIds: z.array(objectIdStringSchema),
  tencentAccountIds: z.array(objectIdStringSchema).optional(),
  aliyunAccountIds: z.array(objectIdStringSchema).optional(),
  volcengineAccountIds: z.array(objectIdStringSchema).optional(),
  huaweiAccountIds: z.array(objectIdStringSchema).optional(),
  azureAccountIds: z.array(objectIdStringSchema).optional(),
  onpremClusterIds: z.array(objectIdStringSchema).optional(),
  betterStackIntegrationIds: z.array(objectIdStringSchema),
  uptimeKumaInstanceIds: z.array(objectIdStringSchema),
  tailscaleClientIds: z.array(objectIdStringSchema),
  zeaburIds: z.array(zeaburIdStringSchema),
  vantaIntegrationIds: z.array(objectIdStringSchema),
  secureframeIntegrationIds: z.array(objectIdStringSchema),
  resendIntegrationIds: z.array(objectIdStringSchema).optional(),
  githubInstallationIds: z.array(z.string().min(1)).optional(),
  gitlabBindingIds: z.array(objectIdStringSchema).optional(),
  grafanaInstanceIds: z.array(objectIdStringSchema).optional(),
  sonarqubeIntegrationIds: z.array(objectIdStringSchema).optional(),
  notionIntegrationIds: z.array(objectIdStringSchema).optional(),
  upstashAccountIds: z.array(objectIdStringSchema).optional(),
  cloudflareAccountIds: z.array(z.string().min(1)).optional(),
  deviceIds: z.array(z.string().min(1)).optional(),
  updatedAt: z.string().datetime().optional(),
  updatedBy: objectIdStringSchema.optional(),
})

export const agentCredentialOptionsSchema = z.object({
  awsRoles: z.array(
    z.object({
      roleId: objectIdStringSchema,
      accountId: z.string().regex(/^\d{12}$/),
      accountAlias: z.string().nullable(),
      roleArn: z.string().min(1),
    }),
  ),
  gcpServiceAccounts: z.array(
    z.object({
      serviceAccountId: objectIdStringSchema,
      projectId: z.string().min(1),
      serviceAccountEmail: z.string().email(),
    }),
  ),
  linodeAccounts: z.array(
    z.object({
      accountId: objectIdStringSchema,
      label: z.string().min(1),
    }),
  ),
  hetznerAccounts: z.array(
    z.object({
      accountId: objectIdStringSchema,
      label: z.string().min(1),
    }),
  ),
  tencentAccounts: z.array(
    z.object({
      accountId: objectIdStringSchema,
      label: z.string().min(1),
      roleArn: z.string().min(1),
    }),
  ),
  aliyunAccounts: z.array(
    z.object({
      accountId: objectIdStringSchema,
      label: z.string().min(1),
      roleArn: z.string().min(1),
    }),
  ),
  volcengineAccounts: z.array(
    z.object({
      accountId: objectIdStringSchema,
      label: z.string().min(1),
      roleTrn: z.string().min(1),
    }),
  ),
  huaweiAccounts: z.array(
    z.object({
      accountId: objectIdStringSchema,
      label: z.string().min(1),
      domainId: z.string().min(1),
      idpId: z.string().min(1),
    }),
  ),
  azureAccounts: z.array(
    z.object({
      accountId: objectIdStringSchema,
      label: z.string().min(1),
      subscriptionId: z.string().min(1),
    }),
  ),
  onpremClusters: z.array(
    z.object({
      clusterId: objectIdStringSchema,
      label: z.string().min(1),
      contextName: z.string().min(1),
    }),
  ),
  betterStackIntegrations: z.array(
    z.object({
      integrationId: objectIdStringSchema,
      label: z.string().min(1),
      hasUptimeApiToken: z.boolean(),
      hasTelemetryApiToken: z.boolean(),
    }),
  ),
  uptimeKumaInstances: z.array(
    z.object({
      instanceId: objectIdStringSchema,
      label: z.string().min(1),
      baseUrl: z.string().url(),
      authType: z.enum(['password', 'token']),
    }),
  ),
  tailscaleClients: z.array(
    z.object({
      clientId: objectIdStringSchema,
      label: z.string().min(1),
      oauthClientId: z.string().min(1),
    }),
  ),
  zeaburProviders: z.array(
    z.object({
      zeaburId: zeaburIdStringSchema,
      kind: z.enum(['user', 'team']),
      name: z.string().min(1),
    }),
  ),
  vantaIntegrations: z.array(
    z.object({
      integrationId: objectIdStringSchema,
      label: z.string().min(1),
      authType: z.enum(['client_credentials', 'oauth']),
    }),
  ),
  secureframeIntegrations: z.array(
    z.object({
      integrationId: objectIdStringSchema,
      label: z.string().min(1),
      region: z.enum(['us', 'uk']),
    }),
  ),
  resendIntegrations: z.array(
    z.object({
      integrationId: objectIdStringSchema,
      label: z.string().min(1),
      permission: z.enum(['full_access', 'sending_access']),
    }),
  ),
  devices: z.array(
    z.object({
      deviceId: z.string().min(1),
      label: z.string().min(1),
      platform: z.string().min(1),
    }),
  ),
})

export const agentCredentialOptionsQuerySchema = z.object({
  teamId: objectIdStringSchema.optional(),
})

export const agentConversationCredentialsPathSchema = z.object({
  sessionId: z.string().min(1).describe('Agent conversation/session id.'),
})

export const agentConversationCredentialsBodySchema = z.object({
  teamId: objectIdStringSchema.optional(),
  credentialAccess: agentCredentialSelectionSchema,
})

export const agentConversationCredentialsResponseSchema = z.object({
  credentialAccess: agentCredentialAccessSchema,
  options: agentCredentialOptionsSchema,
})

export const agentSessionIdentitySchema = z.object({
  sessionId: z.string(),
  userId: objectIdStringSchema,
  subjectId: z.string(),
})

export const awsCredentialsSchema = z.object({
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  sessionToken: z.string().min(1),
  expiresAt: z.string().datetime(),
})

export const gcpCredentialsSchema = z.object({
  accessToken: z.string().min(1),
  projectId: z.string().min(1),
  serviceAccountEmail: z.string().email(),
  expiresAt: z.string().datetime(),
})

export const cloudflareCredentialsSchema = z.object({
  accountId: z.string().min(1),
  accountName: z.string().nullable(),
  apiKey: z.string().min(1),
  authType: z.literal('api_token'),
})

export const tailscaleCredentialsSchema = z.object({
  clientId: objectIdStringSchema,
  label: z.string().min(1),
  oauthClientId: z.string().min(1).describe('Tailscale OAuth client ID used to mint this token.'),
  accessToken: z.string().min(1),
  tokenType: z.string().min(1),
  expiresAt: z.string().datetime(),
  scope: z.string().nullable(),
  tailnet: z
    .literal('-')
    .describe('Tailscale OAuth tokens use "-" to represent the current tailnet.'),
  authType: z.literal('oauth_access_token').optional(),
})
