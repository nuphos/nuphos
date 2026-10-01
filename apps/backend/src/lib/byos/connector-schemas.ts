import { z } from 'zod'

import { AZURE_GUID_PATTERN } from './azure/core'

const guid = (label: string) =>
  z.string().trim().regex(AZURE_GUID_PATTERN, `Invalid Azure ${label} (must be a GUID)`)

export const awsConnectorSchema = z.object({
  roleArn: z.string().regex(/^arn:aws:iam::\d{12}:role\/.+/, 'Invalid AWS role ARN'),
  // Reject retired connection kinds from older clients.
  purpose: z.never().optional(),
})

export const gcpConnectorSchema = z.object({
  serviceAccountEmail: z.string().email(),
  projectId: z.string().min(1),
  // Reject retired connection kinds from older clients.
  purpose: z.never().optional(),
})

export const azureConnectorSchema = z.object({
  label: z.string().trim().min(1).max(100),
  // Entra ID (Azure AD) tenant, app registration (client), and the subscription
  // the app was granted an RBAC role on. All three are GUIDs.
  tenantId: guid('tenant id'),
  clientId: guid('client id'),
  subscriptionId: guid('subscription id'),
  // Reject retired connection kinds from older clients rather than silently
  // treating a privileged credential as an ordinary agent connection.
  purpose: z.never().optional(),
})

export const tencentConnectorSchema = z.object({
  label: z.string().trim().min(1).max(100),
  // Which partition this binding belongs to: `china` (cloud.tencent.com) or
  // `international` (tencentcloud.com). Legacy clients that omit it default to
  // `china` — the original single-partition behavior.
  site: z.enum(['china', 'international']).default('china'),
  // CAM role ARN whose trust policy allows the Nuphos OIDC provider to
  // sts:AssumeRoleWithWebIdentity, e.g. qcs::cam::uin/123456789:roleName/Nuphos.
  roleArn: z
    .string()
    .trim()
    .regex(/^qcs::cam::uin\/\d+:role(Name)?\/.+/, 'Invalid Tencent CAM role ARN'),
  // The CAM OIDC identity provider name the role trusts (Tencent references the
  // provider by name, not ARN, in AssumeRoleWithWebIdentity).
  providerId: z.string().trim().min(1).max(128),
})

export const aliyunConnectorSchema = z.object({
  label: z.string().trim().min(1).max(100),
  // Which partition this binding belongs to: `china` (aliyun.com) or
  // `international` (alibabacloud.com). Legacy clients that omit it default to
  // `china` — the original single-partition behavior.
  site: z.enum(['china', 'international']).default('china'),
  // RAM role ARN whose trust policy allows the Nuphos OIDC provider to
  // sts:AssumeRoleWithOIDC, e.g. acs:ram::123456789:role/NuphosConnector.
  roleArn: z
    .string()
    .trim()
    .regex(/^acs:ram::\d+:role\/.+/, 'Invalid Alibaba Cloud role ARN'),
  // The RAM OIDC provider ARN the role trusts (required by AssumeRoleWithOIDC),
  // e.g. acs:ram::123456789:oidc-provider/nuphos.
  oidcProviderArn: z
    .string()
    .trim()
    .regex(/^acs:ram::\d+:oidc-provider\/.+/, 'Invalid Alibaba Cloud OIDC provider ARN'),
})

export const volcengineConnectorSchema = z.object({
  label: z.string().trim().min(1).max(100),
  // Volcengine IAM role TRN whose trust policy allows the Nuphos connector to
  // sts:AssumeRole, e.g. trn:iam::2100000000:role/NuphosRole.
  roleTrn: z
    .string()
    .trim()
    .regex(/^trn:iam::\d+:role\/.+/, 'Invalid Volcengine role TRN'),
})

export const huaweiConnectorSchema = z.object({
  label: z.string().trim().min(1).max(100),
  // Huawei Cloud account id (IAM domain id) — the "账号ID" on the My Credentials
  // page, always 32 hex chars.
  domainId: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{32}$/i, 'Invalid Huawei Cloud account (domain) id'),
  // Name of the IAM identity provider the customer created for Nuphos — used
  // to build its URN, not the separate hex provider_id Huawei also assigns.
  idpId: z
    .string()
    .trim()
    .regex(/^[\w.-]{1,64}$/, 'Invalid Huawei Cloud identity provider name'),
  // Name of the trust agency the customer assigned to Nuphos's audience on
  // that identity provider.
  agencyName: z
    .string()
    .trim()
    .regex(/^[\w.-]{1,64}$/, 'Invalid Huawei Cloud trust agency name'),
})
