import { z } from 'zod'

import { objectIdStringSchema } from './paths'

const cloudRunConditionSchema = z.object({
  type: z.string(),
  state: z.string(),
  message: z.string().nullable(),
})

const cloudRunTrafficSchema = z.object({
  percent: z.number(),
  revision: z.string().nullable(),
  tag: z.string().nullable(),
  type: z.string().nullable(),
})

export const cloudRunServiceSchema = z.object({
  name: z.string(),
  region: z.string(),
  status: z.string(),
  url: z.string().nullable(),
  serviceAccountEmail: z.string().nullable(),
  ingress: z.string().nullable(),
  latestReadyRevision: z.string().nullable(),
  latestCreatedRevision: z.string().nullable(),
  creator: z.string().nullable(),
  traffic: z.array(cloudRunTrafficSchema),
  conditions: z.array(cloudRunConditionSchema),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

const cloudRunRevisionSchema = z.object({
  name: z.string(),
  service: z.string(),
  region: z.string(),
  image: z.string().nullable(),
  cpu: z.string().nullable(),
  memory: z.string().nullable(),
  maxInstances: z.number().nullable(),
  minInstances: z.number().nullable(),
  serviceAccountEmail: z.string().nullable(),
  conditions: z.array(cloudRunConditionSchema),
  createdAt: z.string().nullable(),
})

export const cloudRunServicesResponseSchema = z.object({
  services: z.array(cloudRunServiceSchema),
})

export const cloudRunRevisionsResponseSchema = z.object({
  revisions: z.array(cloudRunRevisionSchema),
})

const linodeAccountSchema = z.object({
  id: objectIdStringSchema,
  label: z.string().min(1),
  createdAt: z.string().datetime().optional(),
})

const linodeInstanceSchema = z.object({
  id: z.number(),
  label: z.string(),
  region: z.string(),
  type: z.string(),
  status: z.string(),
  ipv4: z.array(z.string()),
  ipv6: z.string().nullable(),
  created: z.string().nullable(),
})

const lkeClusterSchema = z.object({
  id: z.number(),
  label: z.string(),
  region: z.string(),
  k8s_version: z.string(),
  status: z.string(),
  created: z.string().nullable(),
})

export const linodeAccountsResponseSchema = z.object({
  accounts: z.array(linodeAccountSchema),
})

const tailscaleClientSchema = z.object({
  id: objectIdStringSchema,
  label: z.string().min(1),
  clientId: z.string().min(1),
  createdAt: z.string().datetime().optional(),
})

const tailscaleDeviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  hostname: z.string().nullable(),
  os: z.string().nullable(),
  user: z.string().nullable(),
  addresses: z.array(z.string()),
  tags: z.array(z.string()),
  online: z.boolean().nullable(),
  authorized: z.boolean().nullable(),
  createdAt: z.string().nullable(),
  lastSeen: z.string().nullable(),
  expiresAt: z.string().nullable(),
})

export const tailscaleClientsResponseSchema = z.object({
  clients: z.array(tailscaleClientSchema),
})

export const tailscaleDevicesResponseSchema = z.object({
  devices: z.array(tailscaleDeviceSchema),
})

export const linodeInstancesResponseSchema = z.object({
  instances: z.array(linodeInstanceSchema),
})

export const lkeClustersResponseSchema = z.object({
  clusters: z.array(lkeClusterSchema),
})

const hetznerAccountSchema = z.object({
  id: objectIdStringSchema,
  label: z.string().min(1),
  createdAt: z.string().datetime().optional(),
})

const hetznerServerSchema = z.object({
  id: z.number(),
  name: z.string(),
  status: z.string(),
  serverType: z.string(),
  location: z.string(),
  ipv4: z.string().nullable(),
  ipv6: z.string().nullable(),
  created: z.string().nullable(),
})

export const hetznerAccountsResponseSchema = z.object({
  accounts: z.array(hetznerAccountSchema),
})

export const hetznerServersResponseSchema = z.object({
  servers: z.array(hetznerServerSchema),
})

export const hetznerCredentialsSchema = z.object({
  token: z.string().min(1).describe('Hetzner Cloud API token for an account bound to the team.'),
})
