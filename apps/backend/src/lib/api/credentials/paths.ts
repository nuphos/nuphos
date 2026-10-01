import { z } from 'zod'

export const objectIdStringSchema = z.string().regex(/^[a-f0-9]{24}$/i)
export const zeaburIdStringSchema = z.string().trim().min(1).max(120)

export const teamPathSchema = z.object({
  teamId: objectIdStringSchema.describe('Nuphos team id.'),
})

export const agentSessionPathSchema = z.object({
  sessionId: z.string().min(1).describe('Agent conversation/session id.'),
})

export const agentSessionTeamPathSchema = agentSessionPathSchema.merge(teamPathSchema)

export const awsAccountPathSchema = teamPathSchema.extend({
  accountId: z
    .string()
    .regex(/^\d{12}$/)
    .describe('AWS account id.'),
})

export const agentSessionAwsAccountPathSchema = agentSessionTeamPathSchema.extend({
  accountId: z
    .string()
    .regex(/^\d{12}$/)
    .describe('AWS account id.'),
})

export const gcpProjectPathSchema = teamPathSchema.extend({
  projectId: z.string().min(1).describe('GCP project id.'),
})

export const agentSessionGcpProjectPathSchema = agentSessionTeamPathSchema.extend({
  projectId: z.string().min(1).describe('GCP project id.'),
})

export const cloudflareAccountPathSchema = teamPathSchema.extend({
  accountId: z
    .string()
    .regex(/^[a-f0-9]{32}$/i)
    .describe('Cloudflare account id.'),
})

export const agentSessionCloudflareAccountPathSchema = agentSessionTeamPathSchema.extend({
  accountId: z
    .string()
    .regex(/^[a-f0-9]{32}$/i)
    .describe('Cloudflare account id.'),
})

export const linodeAccountPathSchema = teamPathSchema.extend({
  accountId: objectIdStringSchema.describe('Nuphos Linode account binding id.'),
})

export const hetznerAccountPathSchema = teamPathSchema.extend({
  accountId: objectIdStringSchema.describe('Nuphos Hetzner account binding id.'),
})

export const tailscaleClientPathSchema = teamPathSchema.extend({
  clientId: objectIdStringSchema.describe('Nuphos Tailscale OAuth client binding id.'),
})

export const agentSessionTailscaleClientPathSchema = agentSessionTeamPathSchema.extend({
  clientId: objectIdStringSchema.describe('Nuphos Tailscale OAuth client binding id.'),
})

export const gcpCloudRunServicePathSchema = z.object({
  region: z.string().trim().min(1).describe('GCP region, for example us-central1.'),
  name: z.string().trim().min(1).describe('Cloud Run service name.'),
})

export const gcpCloudRunServiceApiPathSchema = gcpProjectPathSchema.merge(
  gcpCloudRunServicePathSchema,
)

export const awsCredentialQuerySchema = z.object({
  roleId: objectIdStringSchema.optional().describe('Optional bound AWS role id.'),
})

export const gcpCredentialQuerySchema = z.object({
  serviceAccountId: objectIdStringSchema
    .optional()
    .describe('Optional bound GCP service account id.'),
})
